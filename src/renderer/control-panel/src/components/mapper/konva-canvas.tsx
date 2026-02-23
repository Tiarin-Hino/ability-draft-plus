import { useRef, useCallback, useState, useEffect } from 'react'
import { Stage, Layer, Image as KonvaImage } from 'react-konva'
import type Konva from 'konva'

interface KonvaCanvasProps {
  imageBase64: string
  imageWidth: number
  imageHeight: number
  containerWidth: number
  containerHeight: number
  onImageClick?: (x: number, y: number) => void
  children?: React.ReactNode
}

const MIN_SCALE = 0.25
const MAX_SCALE = 8

export function KonvaCanvas({
  imageBase64,
  imageWidth,
  imageHeight,
  containerWidth,
  containerHeight,
  onImageClick,
  children,
}: KonvaCanvasProps) {
  const stageRef = useRef<Konva.Stage>(null)
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const isPanning = useRef(false)
  const lastPointer = useRef({ x: 0, y: 0 })

  // Load image via effect
  useEffect(() => {
    if (!imageBase64) return
    const img = new window.Image()
    img.src = `data:image/png;base64,${imageBase64}`
    img.onload = () => {
      setImage(img)
      const fitScale = Math.min(
        containerWidth / imageWidth,
        containerHeight / imageHeight,
      )
      setScale(fitScale)
      setPosition({
        x: (containerWidth - imageWidth * fitScale) / 2,
        y: (containerHeight - imageHeight * fitScale) / 2,
      })
    }
  }, [imageBase64, imageWidth, imageHeight, containerWidth, containerHeight])

  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault()
      const stage = stageRef.current
      if (!stage) return

      const pointer = stage.getPointerPosition()
      if (!pointer) return

      const direction = e.evt.deltaY > 0 ? -1 : 1
      const factor = 1.1
      const newScale = Math.max(
        MIN_SCALE,
        Math.min(MAX_SCALE, direction > 0 ? scale * factor : scale / factor),
      )

      // Zoom toward pointer position
      const mousePointTo = {
        x: (pointer.x - position.x) / scale,
        y: (pointer.y - position.y) / scale,
      }

      setScale(newScale)
      setPosition({
        x: pointer.x - mousePointTo.x * newScale,
        y: pointer.y - mousePointTo.y * newScale,
      })
    },
    [scale, position],
  )

  const handleMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      // Ctrl+click or middle button = pan
      if (e.evt.ctrlKey || e.evt.button === 1) {
        isPanning.current = true
        lastPointer.current = { x: e.evt.clientX, y: e.evt.clientY }
        e.evt.preventDefault()
      }
    },
    [],
  )

  const handleMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!isPanning.current) return
      const dx = e.evt.clientX - lastPointer.current.x
      const dy = e.evt.clientY - lastPointer.current.y
      lastPointer.current = { x: e.evt.clientX, y: e.evt.clientY }
      setPosition((prev) => ({ x: prev.x + dx, y: prev.y + dy }))
    },
    [],
  )

  const handleMouseUp = useCallback(() => {
    isPanning.current = false
  }, [])

  const handleClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!onImageClick || e.evt.ctrlKey || e.evt.button !== 0) return

      const stage = stageRef.current
      if (!stage) return

      const pointer = stage.getPointerPosition()
      if (!pointer) return

      // Convert from screen space to image space
      const imageX = Math.round((pointer.x - position.x) / scale)
      const imageY = Math.round((pointer.y - position.y) / scale)

      // Only register clicks within image bounds
      if (imageX >= 0 && imageX < imageWidth && imageY >= 0 && imageY < imageHeight) {
        onImageClick(imageX, imageY)
      }
    },
    [onImageClick, position, scale, imageWidth, imageHeight],
  )

  const cursor = onImageClick ? 'crosshair' : 'default'

  return (
    <Stage
      ref={stageRef}
      width={containerWidth}
      height={containerHeight}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onClick={handleClick}
      style={{ cursor }}
    >
      <Layer>
        {image && (
          <KonvaImage
            image={image}
            x={position.x}
            y={position.y}
            scaleX={scale}
            scaleY={scale}
          />
        )}
      </Layer>
      <Layer x={position.x} y={position.y} scaleX={scale} scaleY={scale}>
        {children}
      </Layer>
    </Stage>
  )
}
