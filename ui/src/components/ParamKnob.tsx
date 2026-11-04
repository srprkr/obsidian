import type { ParamId } from "../state/parameterIds";
import { useParam } from "../state/hooks";
import { Knob, type KnobProps } from "./Knob";

type ParamKnobProps = Omit<KnobProps, "value" | "min" | "max" | "onChange" | "onGestureStart" | "onGestureEnd" | "displayValue"> & {
  param: ParamId;
  format?: (value: number) => string;
};

/** A Knob bound directly to a plugin parameter (range, value and automation gestures). */
export function ParamKnob({ param, format, ...rest }: ParamKnobProps) {
  const { value, info, set, beginGesture, endGesture } = useParam(param);

  return (
    <Knob
      {...rest}
      value={value}
      min={info.min}
      max={info.max}
      displayValue={format?.(value)}
      onChange={set}
      onGestureStart={beginGesture}
      onGestureEnd={endGesture}
    />
  );
}
