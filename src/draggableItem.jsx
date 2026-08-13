import { useState, useRef, useCallback, useLayoutEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { useDrag } from '@use-gesture/react'
import * as THREE from 'three'

// --- CONSTANTS & SETTINGS ---
// Settings for floor limits, shake duration, and visual feedback sensitivities
const FLOOR_Y = 0
const ON_FLOOR_EPSILON = 0.03
const SHAKE_DURATION = 0.4
const GLOW_DURATION = 3
const ROTATE_SENSITIVITY = 0.018

const _box = new THREE.Box3()
const _center = new THREE.Vector3()
const _size = new THREE.Vector3()

// --- UTILITY: PIXEL TO 3D WORLD ---
function pixelsToWorldFactor(camera, size, worldPoint) {
  if (!camera.isPerspectiveCamera) return 0.01;
  const distance = camera.position.distanceTo(worldPoint);
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const visibleHeight = 2 * Math.tan(vFov / 2) * distance;
  return visibleHeight / size.height;
}


const controlButtonStyle = {
  width: 20,
  height: 20,
  borderRadius: '50%',
  border: '1px solid #d1d5db',
  background: '#ffffff',
  color: '#374151',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'grab',
  userSelect: 'none',
  boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
  fontSize: 18,
  lineHeight: 1,
  padding: 0,
  touchAction: 'none',
}

const controlPanelStyle = {
  display: 'flex',
  gap: 10,
  pointerEvents: 'auto',
}

function FloorGlow({ position, radius }) {
  const pulseRef = useRef()

  useFrame(({ clock }) => {
    if (!pulseRef.current) return
    const pulse = 1 + Math.sin(clock.getElapsedTime() * 10) * 0.05
    pulseRef.current.scale.set(pulse, pulse, 1)
  })

  return (
    <group position={position}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[radius * 1.5, 48]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.1} depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
        <circleGeometry args={[radius * 1.1, 48]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.2} depthWrite={false} />
      </mesh>
      <mesh ref={pulseRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
        <circleGeometry args={[radius * 0.7, 48]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.4} depthWrite={false} />
      </mesh>
    </group>
  )
}


// --- HTML UI CONTROLS ---
// Renders the 2D floating buttons (Y-axis move and Rotate) next to the selected 3D item
function ControlPanel({ bindY, bindRotate }) {
  return (
    <div style={controlPanelStyle}>
      <button type="button" aria-label="Move vertically" style={controlButtonStyle} {...bindY()}>
        ↕
      </button>
      <button type="button" aria-label="Rotate" style={controlButtonStyle} {...bindRotate()}>
        ↻
      </button>
    </div>
  )
}

// --- VISUAL FEEDBACK HOOK ---
// Manages the floor glow circle and the shaking animation when an item is picked up or dropped
function useFloorFeedback(transformRef) {
  const [showGlow, setShowGlow] = useState(false)
  const [glow, setGlow] = useState({ position: [0, 0.015, 0], radius: 0.5 })
  const shakeRef = useRef({ active: false, time: 0, baseX: 0, baseZ: 0 })
  const glowTimerRef = useRef({ active: false, time: 0 })

  const updateGlowPosition = useCallback(() => {
    const group = transformRef.current
    if (!group) return

    _box.setFromObject(group)
    _box.getCenter(_center)
    _box.getSize(_size)
    const radius = Math.max(_size.x, _size.z) * 0.45
    setGlow({
      position: [_center.x, 0.015, _center.z],
      radius: Math.max(radius, 0.15),
    })
  }, [transformRef])

  const hideGlow = useCallback(() => {
    setShowGlow(false)
    glowTimerRef.current.active = false
  }, [])

  const snapToFloor = useCallback(
    (triggerFeedback = false) => {
      const group = transformRef.current
      if (!group) return

      _box.setFromObject(group)
      const bottomY = _box.min.y

      if (bottomY < ON_FLOOR_EPSILON) {
        group.position.y += FLOOR_Y - bottomY

        if (triggerFeedback) {
          shakeRef.current = {
            active: true,
            time: 0,
            baseX: group.position.x,
            baseZ: group.position.z,
          }
          updateGlowPosition()
          setShowGlow(true)
          glowTimerRef.current = { active: true, time: 0 }
        }
      }
    },
    [transformRef, updateGlowPosition]
  )

  const onDragStart = useCallback(() => {
    hideGlow()
  }, [hideGlow])

  const onDragMove = useCallback(() => {
    snapToFloor(false)
  }, [snapToFloor])

  const onDragEnd = useCallback(() => {
    snapToFloor(true)
  }, [snapToFloor])

  useLayoutEffect(() => {
    snapToFloor(true)
  }, [snapToFloor])

  useFrame((_, delta) => {
    const group = transformRef.current
    const shake = shakeRef.current
    const glowTimer = glowTimerRef.current

    if (group && shake.active) {
      shake.time += delta
      if (shake.time < SHAKE_DURATION) {
        const falloff = 1 - shake.time / SHAKE_DURATION
        const intensity = 0.015 * falloff
        group.position.x = shake.baseX + Math.sin(shake.time * 50) * intensity
        group.position.z = shake.baseZ + Math.cos(shake.time * 43) * intensity
      } else {
        group.position.x = shake.baseX
        group.position.z = shake.baseZ
        shake.active = false
      }
    }

    if (glowTimer.active) {
      glowTimer.time += delta
      updateGlowPosition()
      if (glowTimer.time >= GLOW_DURATION) hideGlow()
    }
  })

  return { showGlow, glow, onDragStart, onDragMove, onDragEnd }
}

export default function DraggableItem({ children }) {
  const [isSelected, setIsSelected] = useState(false)
  const [uiPosition, setUiPosition] = useState([0, 1, 0])

  const transformRef = useRef()
  const { camera, size, controls: camControls } = useThree()

  const { showGlow, glow, onDragStart, onDragMove, onDragEnd } = useFloorFeedback(transformRef)

  const setCameraEnabled = useCallback(
    (enabled) => {
      if (camControls) camControls.enabled = enabled
    },
    [camControls]
  )

  const updateUiPosition = useCallback(() => {
    const group = transformRef.current
    if (!group) return

    _box.setFromObject(group)
    _box.getCenter(_center)
    setUiPosition([_center.x, _box.max.y + 0.35, _center.z])
  }, [])

  useFrame(() => {
    if (isSelected) updateUiPosition()
  })

  const bindFloorDrag = useDrag(
    ({ tap, movement: [mx, my], first, last, memo }) => {
      const group = transformRef.current;
      if (!group) return;

      // 1. Toggle the menu if the item is just clicked
      if (tap) {
        setIsSelected((prev) => !prev);
        return;
      }

      // 2. Store the initial position when dragging starts
      if (first) {
        onDragStart();
        setCameraEnabled(false);
        return group.position.clone(); // start position
      }

      // 3. While dragging continues
      const start = memo;
      if (start) {
        const factor = pixelsToWorldFactor(camera, size, group.position);
        
        // Get camera's world direction (set Y to 0 to prevent lifting off the floor)
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).setY(0).normalize();
        const back = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion).setY(0).normalize();
        
        // Calculate new direction by applying mouse movement based on camera's perspective
        const delta = new THREE.Vector3()
          .addScaledVector(right, mx * factor)
          .addScaledVector(back, my * factor);

        // Move the item to its new position
        group.position.x = start.x + delta.x;
        group.position.z = start.z + delta.z;
        
        onDragMove();
      }

      // 4. Enable the camera when the mouse is released
      if (last) {
        setCameraEnabled(true);
        onDragEnd();
      }
      return memo;
    },
    { filterTaps: true, pointer: { touch: true } }
  );

  const bindYDrag = useDrag(
    ({ movement: [, my], first, last, memo }) => {
      const group = transformRef.current;
      if (!group) return;

      if (first) {
        onDragStart();
        setCameraEnabled(false);
        return group.position.y;
      }

      const startY = memo;
      const factor = pixelsToWorldFactor(camera, size, group.position);
      
      group.position.y = startY - my * factor;
      
      onDragMove();

      if (last) {
        setCameraEnabled(true);
        onDragEnd();
      }
    },
    { pointer: { touch: true } }
  );

  const bindRotateDrag = useDrag(
    ({ movement: [mx], first, last, memo }) => {
      const group = transformRef.current
      if (!group) return

      if (first) {
        onDragStart()
        setCameraEnabled(false)
        return group.rotation.y
      }

      group.rotation.y = memo - mx * ROTATE_SENSITIVITY

      if (last) {
        setCameraEnabled(true)
        onDragEnd()
      }
    },
    { pointer: { touch: true } }
  )

  return (
    <>
      <group ref={transformRef}>
        <group {...bindFloorDrag()}>{children}</group>
      </group>

      {isSelected && (
        <Html position={uiPosition} center distanceFactor={10} pointerEvents="auto" zIndexRange={[100, 0]}>
          <ControlPanel bindY={bindYDrag} bindRotate={bindRotateDrag} />
        </Html>
      )}

      {showGlow && <FloorGlow position={glow.position} radius={glow.radius} />}
    </>
  )
}
