import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions, Modal } from 'react-native';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const HOLE_PADDING = 8;

export interface SpotlightStep {
  ref: React.RefObject<any>;
  title: string;
  body: string;
}

interface Props {
  steps: SpotlightStep[];
  onDone: () => void;
}

interface Hole {
  left: number;
  top: number;
  width: number;
  height: number;
  radius: number;
}

export default function SpotlightOverlay({ steps, onDone }: Props) {
  const [stepIndex, setStepIndex] = useState(0);
  const [hole, setHole] = useState<Hole | null>(null);
  const stepIndexRef = useRef(0);

  useEffect(() => {
    stepIndexRef.current = stepIndex;
    measureStep(stepIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex]);

  function measureStep(index: number) {
    const step = steps[index];
    if (!step) {
      onDone();
      return;
    }
    const node = step.ref.current;
    if (!node || typeof node.measureInWindow !== 'function') {
      goToStep(index + 1); // target never mounted (e.g. no categories yet) — skip it
      return;
    }
    node.measureInWindow((x: number, y: number, width: number, height: number) => {
      if (stepIndexRef.current !== index) return; // stale: user has moved on since this was requested
      if (!width || !height) {
        goToStep(index + 1); // target not laid out / hidden — skip it
        return;
      }
      const holeWidth = width + HOLE_PADDING * 2;
      const holeHeight = height + HOLE_PADDING * 2;
      setHole({
        left: x - HOLE_PADDING,
        top: y - HOLE_PADDING,
        width: holeWidth,
        height: holeHeight,
        radius: Math.min(holeWidth, holeHeight) / 2,
      });
    });
  }

  function goToStep(index: number) {
    if (index >= steps.length) {
      onDone();
      return;
    }
    setHole(null);
    setStepIndex(index);
  }

  if (!hole) return null;

  const step = steps[stepIndex];
  const holeBottom = hole.top + hole.height;
  const spaceBelow = SCREEN_HEIGHT - holeBottom;
  const tooltipBelow = spaceBelow > 180;

  return (
    <Modal
      transparent
      visible
      animationType="none"
      statusBarTranslucent
      onRequestClose={onDone}
    >
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* 4-panel dark mask leaves a hole exactly around the target */}
      <View style={[styles.mask, { top: 0, left: 0, right: 0, height: Math.max(0, hole.top) }]} />
      <View style={[styles.mask, { top: holeBottom, left: 0, right: 0, bottom: 0 }]} />
      <View
        style={[
          styles.mask,
          { top: hole.top, height: hole.height, left: 0, width: Math.max(0, hole.left) },
        ]}
      />
      <View
        style={[
          styles.mask,
          { top: hole.top, height: hole.height, left: hole.left + hole.width, right: 0 },
        ]}
      />

      {/* Glowing outline around the hole */}
      <View
        pointerEvents="none"
        style={[
          styles.ring,
          {
            left: hole.left,
            top: hole.top,
            width: hole.width,
            height: hole.height,
            borderRadius: hole.radius,
          },
        ]}
      />

      {/* Tooltip, anchored below or above the hole depending on available space */}
      <View
        style={[
          styles.tooltip,
          tooltipBelow ? { top: holeBottom + 16 } : { bottom: SCREEN_HEIGHT - hole.top + 16 },
        ]}
      >
        <Text style={styles.stepCount}>
          {stepIndex + 1} / {steps.length}
        </Text>
        <Text style={styles.title}>{step.title}</Text>
        <Text style={styles.body}>{step.body}</Text>
        <View style={styles.actions}>
          <TouchableOpacity onPress={onDone} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.skipText}>Skip</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.nextBtn}
            onPress={() => goToStep(stepIndex + 1)}
            activeOpacity={0.85}
          >
            <Text style={styles.nextText}>{stepIndex + 1 >= steps.length ? 'Got it' : 'Next'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  mask: { position: 'absolute', backgroundColor: 'rgba(15,23,42,0.8)' },
  ring: {
    position: 'absolute',
    borderWidth: 3,
    borderColor: '#facc15',
    shadowColor: '#facc15',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 10,
    elevation: 8,
  },
  tooltip: {
    position: 'absolute',
    left: 24,
    right: 24,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    gap: 6,
  },
  stepCount: { fontSize: 11, fontWeight: '700', color: '#94a3b8', letterSpacing: 0.5 },
  title: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  body: { fontSize: 13, color: '#64748b', lineHeight: 18 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  skipText: { fontSize: 13, fontWeight: '600', color: '#94a3b8' },
  nextBtn: { backgroundColor: '#2563eb', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  nextText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
