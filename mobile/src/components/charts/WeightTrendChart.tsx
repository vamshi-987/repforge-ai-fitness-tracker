import { useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';

import { domainOf, linePath, scalePoints, type Datum, type Frame } from '@/charts/geometry';
import { useTheme } from '@/theme/useTheme';

const HEIGHT = 200;
const DEFAULT_WIDTH = 320;

interface WeightTrendChartProps {
  /** Every weigh-in. */
  dots: Datum[];
  /** Weekly averages, drawn as the trend line. */
  line: Datum[];
  label: string;
  formatY: (value: number) => string;
  formatX: (value: number) => string;
}

/** Daily weigh-ins as faint dots and the weekly average as a line, on one shared scale. */
export function WeightTrendChart({ dots, line, label, formatY, formatX }: WeightTrendChartProps) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const frame: Frame = { width, height: HEIGHT, left: 8, right: 8, top: 20, bottom: 24 };
  const domain = domainOf(dots, line);
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));
  if (!domain) return <View accessible accessibilityLabel={label} />;
  const dotPoints = scalePoints(dots, frame, domain);
  const linePoints = scalePoints(line, frame, domain);

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
          {formatY(domain.y[1])}
        </SvgText>
        <SvgText x={frame.left} y={HEIGHT - frame.bottom - 4} fontSize={11} fill={colors.textMuted}>
          {formatY(domain.y[0])}
        </SvgText>
        {dotPoints.map((p, i) => (
          <Circle key={`d${i}`} cx={p.x} cy={p.y} r={3} fill={colors.primaryMuted} />
        ))}
        {linePoints.length > 1 ? (
          <Path d={linePath(linePoints)} stroke={colors.primary} strokeWidth={2.5} fill="none" />
        ) : null}
        {linePoints.map((p, i) => (
          <Circle key={`l${i}`} cx={p.x} cy={p.y} r={4} fill={colors.primary} />
        ))}
        <SvgText x={frame.left} y={HEIGHT - 6} fontSize={11} fill={colors.textMuted}>
          {formatX(domain.x[0])}
        </SvgText>
        {domain.x[1] > domain.x[0] ? (
          <SvgText
            x={width - frame.right}
            y={HEIGHT - 6}
            fontSize={11}
            fill={colors.textMuted}
            textAnchor="end"
          >
            {formatX(domain.x[1])}
          </SvgText>
        ) : null}
      </Svg>
    </View>
  );
}
