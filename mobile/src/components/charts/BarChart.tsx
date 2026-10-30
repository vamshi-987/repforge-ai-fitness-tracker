import { useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Svg, { Rect, Text as SvgText } from 'react-native-svg';

import { bars, type Frame } from '@/charts/geometry';
import { useTheme } from '@/theme/useTheme';

const HEIGHT = 160;
const DEFAULT_WIDTH = 320;

interface BarChartProps {
  values: number[];
  /** One short label under each bar ("12 Oct"); empty strings are skipped. */
  labels: string[];
  label: string;
  formatValue: (value: number) => string;
}

/** Bars from zero with the highest value written above the chart. */
export function BarChart({ values, labels, label, formatValue }: BarChartProps) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const frame: Frame = { width, height: HEIGHT, left: 4, right: 4, top: 18, bottom: 20 };
  const drawn = bars(values, frame);
  const max = Math.max(0, ...values);
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));

  return (
    <View accessible accessibilityLabel={label} onLayout={onLayout}>
      <Svg width={width} height={HEIGHT}>
        <SvgText x={frame.left} y={12} fontSize={11} fill={colors.textMuted}>
          {formatValue(max)}
        </SvgText>
        {drawn.map((bar, i) => (
          <Rect
            key={i}
            x={bar.x}
            y={bar.y}
            width={bar.width}
            height={Math.max(bar.height, values[i] ? 2 : 0)}
            rx={3}
            fill={i === drawn.length - 1 ? colors.primary : colors.primaryMuted}
          />
        ))}
        {drawn.map((bar, i) =>
          labels[i] ? (
            <SvgText
              key={`l${i}`}
              x={bar.x + bar.width / 2}
              y={HEIGHT - 6}
              fontSize={10}
              fill={colors.textMuted}
              textAnchor="middle"
            >
              {labels[i]}
            </SvgText>
          ) : null,
        )}
      </Svg>
    </View>
  );
}
