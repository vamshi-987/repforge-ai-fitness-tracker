import { useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';

import { linePath, linePoints, yDomain, type Datum, type Frame } from '@/charts/geometry';
import { useTheme } from '@/theme/useTheme';

const HEIGHT = 180;
const DEFAULT_WIDTH = 320;

interface LineChartProps {
  data: Datum[];
  /** Screen-reader summary of the whole chart. */
  label: string;
  formatY: (value: number) => string;
  formatX: (value: number) => string;
  /** Points drawn hollow (e.g. rough estimates). */
  hollow?: (index: number) => boolean;
}

/** A small line chart: the series, dots, the y range and the first and last x labels. */
export function LineChart({ data, label, formatY, formatX, hollow }: LineChartProps) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const frame: Frame = { width, height: HEIGHT, left: 8, right: 8, top: 20, bottom: 24 };
  const points = linePoints(data, frame);
  const [low, high] = data.length ? yDomain(data.map((d) => d.y)) : [0, 0];
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));
  const first = data[0];
  const last = data.at(-1);

  return (
    <View accessible accessibilityLabel={label} onLayout={onLayout}>
      <Svg width={width} height={HEIGHT}>
        <Line
          x1={frame.left}
          x2={width - frame.right}
          y1={HEIGHT - frame.bottom}
          y2={HEIGHT - frame.bottom}
          stroke={colors.border}
        />
        <SvgText x={frame.left} y={12} fontSize={11} fill={colors.textMuted}>
          {formatY(high)}
        </SvgText>
        <SvgText x={frame.left} y={HEIGHT - frame.bottom - 4} fontSize={11} fill={colors.textMuted}>
          {formatY(low)}
        </SvgText>
        {points.length > 1 ? (
          <Path d={linePath(points)} stroke={colors.primary} strokeWidth={2} fill="none" />
        ) : null}
        {points.map((p, i) => (
          <Circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={4}
            stroke={colors.primary}
            strokeWidth={2}
            fill={hollow?.(i) ? colors.surface : colors.primary}
          />
        ))}
        {first ? (
          <SvgText x={frame.left} y={HEIGHT - 6} fontSize={11} fill={colors.textMuted}>
            {formatX(first.x)}
          </SvgText>
        ) : null}
        {last && data.length > 1 ? (
          <SvgText
            x={width - frame.right}
            y={HEIGHT - 6}
            fontSize={11}
            fill={colors.textMuted}
            textAnchor="end"
          >
            {formatX(last.x)}
          </SvgText>
        ) : null}
      </Svg>
    </View>
  );
}
