"use client";

/**
 * The Scheduled page: Yours (a dense table of the user's tasks, or the empty
 * state with the starter templates) and Templates (all four cards). A task's
 * chat lives at `/scheduled/{id}`; the New task menu splits into the chat seed
 * and the manual form.
 */
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Center } from "@astryxdesign/core/Center";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { Divider } from "@astryxdesign/core/Divider";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { StackItem } from "@astryxdesign/core/Layout";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Switch } from "@astryxdesign/core/Switch";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { ToggleButton } from "@astryxdesign/core/ToggleButton";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import { VStack } from "@astryxdesign/core/VStack";
import {
  ArrowPathIcon,
  CalendarDaysIcon,
  ClockIcon,
  EyeIcon,
  LightBulbIcon,
  MagnifyingGlassIcon,
  SunIcon,
} from "@heroicons/react/24/outline";
import type { ComponentType, SVGProps } from "react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, isSignedOut } from "@/api/client";
import type { AgentSchedule, ScheduleStatus } from "@/api/types";
import { goToLogin } from "@/chat/use-conversation";
import { describeTiming } from "@/schedule/describe";
import { browserTimeZone, formToTiming } from "@/schedule/form";
import {
  TEMPLATES,
  templateValues,
  type ScheduleTemplate,
} from "@/schedule/templates";
import { CardGrid, EntityCard, Fact } from "@/ui/cards/EntityCard";
import { DeleteScheduleDialog } from "@/ui/scheduled/ScheduleDialogs";
import { SESSIONS_CHANGED } from "@/ui/shell/session-actions";

type View = "yours" | "templates";

/** Width of the page column, as on claude.ai. */
const COLUMN_WIDTH = 880;

const TEMPLATE_ICONS: Record<
  ScheduleTemplate["id"],
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  "daily-briefing": SunIcon,
  "weekly-review": CalendarDaysIcon,
  "monitor-topic": EyeIcon,
  "content-ideas": LightBulbIcon,
};

const scheduleLine = (template: ScheduleTemplate): string =>
  describeTiming(formToTiming(templateValues(template, browserTimeZone())));

function TemplateGrid({
  onPick,
}: {
  onPick: (template: ScheduleTemplate) => void;
}) {
  const rows: ScheduleTemplate[][] = [];
  for (let index = 0; index < TEMPLATES.length; index += 2)
    rows.push(TEMPLATES.slice(index, index + 2));
  return (
    <VStack gap={3}>
      {rows.map((row) => (
        <HStack
          key={row.map((template) => template.id).join("-")}
          gap={3}
          vAlign="stretch"
        >
          {row.map((template) => (
            <StackItem key={template.id} size="fill">
              <ClickableCard
                label={template.title}
                onClick={() => onPick(template)}
                width="100%"
              >
                <HStack gap={3} vAlign="start">
                  <Icon icon={TEMPLATE_ICONS[template.id]} color="secondary" />
                  <VStack gap={1}>
                    <Text weight="medium">{template.title}</Text>
                    <Text type="supporting" color="secondary">
                      {template.description}
                    </Text>
                    <HStack gap={1} vAlign="center">
                      <Icon icon={ClockIcon} size="sm" color="secondary" />
                      <Text type="supporting" color="secondary">
                        {scheduleLine(template)}
                      </Text>
                    </HStack>
                  </VStack>
                </HStack>
              </ClickableCard>
            </StackItem>
          ))}
        </HStack>
      ))}
    </VStack>
  );
}

export function ScheduledPage() {
  const router = useRouter();
  const [view, setView] = useState<View>("yours");
  const [schedules, setSchedules] = useState<AgentSchedule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AgentSchedule | null>(null);

  const load = useCallback(async () => {
    try {
      const page = await api.listSchedules();
      setSchedules(page.data);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && isSignedOut(err)) {
        goToLogin();
        return;
      }
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not load scheduled tasks.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
    const onChange = () => void load();
    window.addEventListener(SESSIONS_CHANGED, onChange);
    return () => window.removeEventListener(SESSIONS_CHANGED, onChange);
  }, [load]);

  const replaceRow = (next: AgentSchedule) =>
    setSchedules((rows) =>
      rows ? rows.map((row) => (row.id === next.id ? next : row)) : rows,
    );

  const explain = (err: unknown, fallback: string) => {
    if (err instanceof ApiError && isSignedOut(err)) {
      goToLogin();
      return;
    }
    setActionError(err instanceof ApiError ? err.message : fallback);
  };

  const toggle = async (task: AgentSchedule) => {
    setActionError(null);
    setPending(task.id);
    const nextStatus: ScheduleStatus =
      task.status === "active" ? "paused" : "active";
    setSchedules((rows) =>
      rows
        ? rows.map((row) =>
            row.id === task.id ? { ...row, status: nextStatus } : row,
          )
        : rows,
    );
    try {
      replaceRow(
        task.status === "active"
          ? await api.pauseSchedule(task.id)
          : await api.resumeSchedule(task.id),
      );
    } catch (err) {
      replaceRow(task);
      explain(err, "Could not update the task.");
    } finally {
      setPending(null);
    }
  };

  const runNow = async (task: AgentSchedule) => {
    setActionError(null);
    setPending(task.id);
    try {
      replaceRow(await api.runSchedule(task.id));
    } catch (err) {
      explain(err, "Could not start the task.");
    } finally {
      setPending(null);
    }
  };

  const deleted = (id: string) =>
    setSchedules((rows) => (rows ? rows.filter((row) => row.id !== id) : rows));

  const needle = query.trim().toLowerCase();
  const rows = (schedules ?? []).filter((task) =>
    needle === "" ? true : task.title.toLowerCase().includes(needle),
  );

  const newTask = (
    <DropdownMenu
      button={{ label: "New task", variant: "primary", size: "sm" }}
      items={[
        {
          label: "Create with chat",
          onClick: () => router.push("/?schedule=1"),
        },
        {
          label: "Set up manually",
          onClick: () => router.push("/scheduled/new"),
        },
      ]}
      alignment="end"
    />
  );

  const pickTemplate = (template: ScheduleTemplate) =>
    router.push(`/scheduled/new?template=${template.id}`);

  const content =
    schedules === null && error === null ? (
      <VStack gap={3} data-testid="scheduled-loading">
        <Skeleton height={44} index={0} />
        <Skeleton height={44} index={1} />
        <Skeleton height={44} index={2} />
      </VStack>
    ) : schedules && schedules.length > 0 ? (
      <VStack gap={3}>
        <VStack maxWidth={360}>
          <TextInput
            label="Search tasks"
            isLabelHidden
            type="search"
            size="sm"
            placeholder="Search tasks"
            startIcon={MagnifyingGlassIcon}
            value={query}
            onChange={setQuery}
            hasClear
          />
        </VStack>
        {rows.length === 0 ? (
          <Text type="supporting">No tasks match “{query.trim()}”.</Text>
        ) : (
          <CardGrid label="Scheduled tasks">
            {rows.map((task) => (
              <EntityCard
                key={task.id}
                href={`/scheduled/${task.id}`}
                title={task.title}
                dimmed={task.status !== "active"}
                trailing={
                  <>
                    {task.status === "ended" ? (
                      <Text type="supporting" color="secondary">Ended</Text>
                    ) : (
                      <Switch
                        label={`${task.status === "active" ? "Pause" : "Resume"} ${task.title}`}
                        value={task.status === "active"}
                        onChange={() => void toggle(task)}
                        isLabelHidden
                        size="sm"
                        isDisabled={pending === task.id}
                      />
                    )}
                    <MoreMenu
                      label={`More options for ${task.title}`}
                      size="sm"
                      alignment="end"
                      items={[
                        { label: "Run now", onClick: () => void runNow(task) },
                        {
                          label: "Edit",
                          onClick: () => router.push(`/scheduled/${task.id}/edit`),
                        },
                        { type: "divider" },
                        {
                          label: "Delete",
                          variant: "destructive",
                          onClick: () => setDeleting(task),
                        },
                      ]}
                    />
                  </>
                }
                footer={
                  <>
                    <Fact icon={<Icon icon={ArrowPathIcon} size="sm" color="secondary" />}>
                      {task.running
                        ? "Running now"
                        : task.status === "paused"
                          ? "Paused"
                          : task.status === "ended"
                            ? "No more runs"
                            : "Waiting"}
                    </Fact>
                    {task.next_run_at && (
                      <Fact icon={<Icon icon={ClockIcon} size="sm" color="secondary" />}>
                        <Timestamp value={task.next_run_at} format="date_time" type="supporting" />
                      </Fact>
                    )}
                  </>
                }
              >
                <Text type="supporting" color="secondary" maxLines={2}>
                  {describeTiming(task.timing, undefined, browserTimeZone())}
                </Text>
              </EntityCard>
            ))}
          </CardGrid>
        )}
      </VStack>
    ) : (
      <Center axis="both" paddingBlock={8}>
        <VStack gap={4} width="100%" hAlign="center">
          <EmptyState
            icon={<Icon icon={ClockIcon} size="lg" color="secondary" />}
            title="No scheduled tasks yet."
            description="Set one up yourself, or start from a template below."
            actions={
              <Button
                label="Set up manually"
                onClick={() => router.push("/scheduled/new")}
              />
            }
          />
          <Divider label="Templates" />
          <TemplateGrid onPick={pickTemplate} />
        </VStack>
      </Center>
    );

  return (
    <div
      style={{
        width: "100%",
        maxWidth: COLUMN_WIDTH,
        margin: "0 auto",
        padding: "24px 16px",
      }}
    >
      <VStack gap={4}>
        <Heading level={1} type="display-2">
          Scheduled tasks
        </Heading>
        <HStack gap={3} vAlign="center">
          <StackItem size="fill">
            <HStack
              gap={1}
              vAlign="center"
              role="group"
              aria-label="Scheduled tasks view"
            >
              <ToggleButton
                label="Yours"
                size="sm"
                isPressed={view === "yours"}
                onPressedChange={() => setView("yours")}
              />
              <ToggleButton
                label="Templates"
                size="sm"
                isPressed={view === "templates"}
                onPressedChange={() => setView("templates")}
              />
            </HStack>
          </StackItem>
          {newTask}
        </HStack>
        {error !== null && (
          <VStack>
            <Banner
              status="error"
              title={error}
              endContent={
                <Button label="Retry" size="sm" onClick={() => void load()} />
              }
            />
          </VStack>
        )}
        {actionError !== null && (
          <VStack>
            <Banner
              status="error"
              title={actionError}
              isDismissable
              onDismiss={() => setActionError(null)}
            />
          </VStack>
        )}
        {view === "templates" ? (
          <TemplateGrid onPick={pickTemplate} />
        ) : (
          content
        )}
        <DeleteScheduleDialog
          schedule={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={deleted}
        />
      </VStack>
    </div>
  );
}
