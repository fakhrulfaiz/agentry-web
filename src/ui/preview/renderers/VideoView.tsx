'use client'

/**
 * Video files in the preview panel (`.webm`, `.mp4`): a native player at the panel's width. When a browser
 * recording's cursor file (`<name>.cursor.jsonl`) sits beside it, the agent's cursor is drawn over the video
 * with the live view's overlay (`BrowserCursor`), following the video's current time.
 */
import { Banner } from '@astryxdesign/core/Banner'
import * as stylex from '@stylexjs/stylex'
import { useEffect, useMemo, useRef, useState } from 'react'
import { cursorAt, cursorPathFor, pageRect, parseCursorTrack } from '@/preview/cursor-track'
import { fileUrl, useFileText } from '@/preview/use-file-bytes'
import { BrowserCursor } from '../BrowserCursor'

const styles = stylex.create({
  frame: { position: 'relative', inlineSize: '100%', blockSize: '100%', display: 'flex', alignItems: 'flex-start', justifyContent: 'center' },
  stage: { position: 'relative', inlineSize: '100%', maxBlockSize: '100%' },
  video: { display: 'block', inlineSize: '100%', maxBlockSize: '100%', objectFit: 'contain' },
  overlay: { position: 'absolute', pointerEvents: 'none' },
})

export interface VideoViewProps {
  sessionId: string
  path: string
  reloadKey: number
}

export function VideoView({ sessionId, path, reloadKey }: VideoViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const sidecar = useFileText(sessionId, cursorPathFor(path), reloadKey)
  const track = useMemo(() => (sidecar.status === 'ok' && sidecar.text !== undefined ? parseCursorTrack(sidecar.text) : undefined), [sidecar.status, sidecar.text])
  const [clock, setClock] = useState(0)
  const [box, setBox] = useState({ width: 0, height: 0 })
  const [intrinsic, setIntrinsic] = useState({ width: 0, height: 0 })
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
    setClock(0)
  }, [path, reloadKey])

  // The element's box, for the overlay's place.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const measure = () => {
      const r = video.getBoundingClientRect()
      setBox((prev) => (prev.width === r.width && prev.height === r.height ? prev : { width: r.width, height: r.height }))
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(video)
    return () => { observer?.disconnect() }
  }, [])

  // The video's time drives the cursor: every animation frame while playing, and on seek and pause.
  useEffect(() => {
    const video = videoRef.current
    if (!video || track === undefined) return
    let raf = 0
    const read = () => { setClock(video.currentTime * 1000) }
    const loop = () => {
      read()
      raf = requestAnimationFrame(loop)
    }
    const play = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(loop) }
    const stop = () => { cancelAnimationFrame(raf); read() }
    video.addEventListener('play', play)
    video.addEventListener('pause', stop)
    video.addEventListener('ended', stop)
    video.addEventListener('seeked', read)
    video.addEventListener('timeupdate', read)
    read()
    return () => {
      cancelAnimationFrame(raf)
      video.removeEventListener('play', play)
      video.removeEventListener('pause', stop)
      video.removeEventListener('ended', stop)
      video.removeEventListener('seeked', read)
      video.removeEventListener('timeupdate', read)
    }
  }, [track])

  const now = track === undefined ? undefined : cursorAt(track, clock)
  const page = now?.page ?? (intrinsic.width > 0 ? intrinsic : undefined)
  const rect = page === undefined ? undefined : pageRect(box, intrinsic, page)

  if (failed) return <Banner status="error" title="Could not play this video. Download it instead." />
  return (
    <div {...stylex.props(styles.frame)}>
      <div {...stylex.props(styles.stage)}>
        <video
          ref={videoRef}
          data-testid="preview-video"
          src={fileUrl(sessionId, path)}
          controls
          preload="metadata"
          playsInline
          onLoadedMetadata={(e) => { setIntrinsic({ width: e.currentTarget.videoWidth, height: e.currentTarget.videoHeight }) }}
          onError={() => { setFailed(true) }}
          {...stylex.props(styles.video)}
        />
        {now !== undefined && rect !== undefined && (
          <div data-testid="video-cursor-overlay" {...stylex.props(styles.overlay)} style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}>
            <BrowserCursor pointer={now.pointer} focus={now.focus} page={page} inControl={false} clock={clock} />
          </div>
        )}
      </div>
    </div>
  )
}
