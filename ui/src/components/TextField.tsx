import { css, styled } from "next-yak";
import {
  type ChangeEvent,
  type FocusEvent,
  type InputHTMLAttributes,
  forwardRef,
  useId,
  useState,
} from "react";
import { tokens } from "../styles/tokens";

type Native = Omit<InputHTMLAttributes<HTMLInputElement>, "size">;

/** Where the outlined label sits over the input, and where it rides up to. */
const LABEL_RESTING = "translate(14px, 16px) scale(1)";
const LABEL_SHRUNK = "translate(14px, -9px) scale(0.75)";
/**
 * (8 + 5) * 2 / 0.75 works out at 34px, but MUI lets the label bleed a little
 * on the left and uses 32px.
 */
const LABEL_SHRUNK_MAX_WIDTH = "calc(133% - 32px)";
/** Legend height, kept in sync with the unlabelled legend's line-height. */
const NOTCH_HEIGHT = "11px";

interface TextFieldProps extends Native {
  label?: string;
  error?: boolean;
  helperText?: string;
  fullWidth?: boolean;
  inputProps?: Native;
}

/**
 * The outlined TextField: a label that floats up into a notch cut out of the
 * fieldset around the input. The notch is a real `<legend>` whose `max-width`
 * animates from nothing to its text, which is how Material gets the border to
 * open and close around the label without drawing two overlapping borders.
 */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  (
    { label, error = false, helperText, fullWidth = false, id, className, inputProps, ...rest },
    ref,
  ) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const [focused, setFocused] = useState(false);
    const [dirty, setDirty] = useState(false);

    const controlledValue = rest.value ?? inputProps?.value;
    const filled =
      controlledValue === undefined
        ? dirty
        : controlledValue !== "" && controlledValue !== null && controlledValue !== undefined;
    const placeholder = rest.placeholder ?? inputProps?.placeholder;
    const shrink = focused || filled || Boolean(placeholder);
    const disabled = Boolean(rest.disabled ?? inputProps?.disabled);
    const hasLabel = Boolean(label);

    const onFocus = (event: FocusEvent<HTMLInputElement>) => {
      setFocused(true);
      rest.onFocus?.(event);
    };

    const onBlur = (event: FocusEvent<HTMLInputElement>) => {
      setFocused(false);
      rest.onBlur?.(event);
    };

    const onChange = (event: ChangeEvent<HTMLInputElement>) => {
      setDirty(event.target.value !== "");
      rest.onChange?.(event);
    };

    return (
      <FormControl className={className} $fullWidth={fullWidth}>
        {hasLabel && (
          <Label htmlFor={inputId} $shrink={shrink} $focused={focused} $error={error} $disabled={disabled}>
            {label}
          </Label>
        )}
        <InputRoot $focused={focused} $error={error} $disabled={disabled}>
          <Input
            ref={ref}
            id={inputId}
            aria-invalid={error}
            aria-describedby={helperText ? `${inputId}-helper` : undefined}
            {...inputProps}
            {...rest}
            onFocus={onFocus}
            onBlur={onBlur}
            onChange={onChange}
          />
          <Fieldset aria-hidden className="notched-outline">
            <Legend $withLabel={hasLabel} $notched={hasLabel && shrink}>
              {hasLabel ? <span>{label}</span> : <span className="notranslate">&#8203;</span>}
            </Legend>
          </Fieldset>
        </InputRoot>
        {helperText && (
          <Helper id={`${inputId}-helper`} $error={error}>
            {helperText}
          </Helper>
        )}
      </FormControl>
    );
  },
);

TextField.displayName = "TextField";

const FormControl = styled.div<{ $fullWidth: boolean }>`
  display: inline-flex;
  flex-direction: column;
  position: relative;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
  vertical-align: top;
  width: ${(p) => (p.$fullWidth ? "100%" : "auto")};
  flex: ${(p) => (p.$fullWidth ? "1" : "0 1 auto")};
`;

/**
 * `translate(14px, 16px)` centres the label on the input's text; shrunk, it
 * rides up to `-9px` at 0.75 scale so it straddles the top border.
 */
const Label = styled.label<{
  $shrink: boolean;
  $focused: boolean;
  $error: boolean;
  $disabled: boolean;
}>`
  display: block;
  position: absolute;
  top: 0;
  left: 0;
  z-index: 1;
  max-width: calc(100% - 24px);
  padding: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  transform-origin: top left;
  transform: ${LABEL_RESTING};
  color: ${tokens.text.secondary};
  font-size: 1rem;
  line-height: 1.4375em;
  pointer-events: none;
  transition: color 200ms ${tokens.motion.easeOut} 0ms,
    transform 200ms ${tokens.motion.easeOut} 0ms, max-width 200ms ${tokens.motion.easeOut} 0ms;

  ${(p) =>
    p.$shrink &&
    css`
      max-width: ${LABEL_SHRUNK_MAX_WIDTH};
      transform: ${LABEL_SHRUNK};
      pointer-events: auto;
      user-select: none;
    `}

  ${(p) =>
    p.$focused &&
    css`
      color: ${tokens.brand.blue};
    `}

  ${(p) =>
    p.$error &&
    css`
      color: ${tokens.trading.short};
    `}

  ${(p) =>
    p.$disabled &&
    css`
      color: ${tokens.text.disabled};
    `}
`;

const InputRoot = styled.div<{ $focused: boolean; $error: boolean; $disabled: boolean }>`
  display: inline-flex;
  position: relative;
  align-items: center;
  box-sizing: border-box;
  width: 100%;
  border-radius: ${tokens.radius.sm};
  background-color: ${tokens.surface.inputIsland};
  color: ${tokens.text.primary};
  font-size: 1rem;
  line-height: 1.4375em;
  cursor: text;

  .notched-outline {
    border-color: ${tokens.border.default};
  }

  &:hover .notched-outline {
    border-color: ${tokens.brand.blue};
  }

  @media (hover: none) {
    &:hover .notched-outline {
      border-color: ${tokens.border.default};
    }
  }

  ${(p) =>
    p.$focused &&
    css`
      .notched-outline,
      &:hover .notched-outline {
        border-color: ${tokens.brand.blue};
        border-width: 2px;
      }
    `}

  ${(p) =>
    p.$error &&
    css`
      .notched-outline,
      &:hover .notched-outline {
        border-color: ${tokens.trading.short};
      }
    `}

  ${(p) =>
    p.$disabled &&
    css`
      color: ${tokens.text.disabled};
      cursor: default;

      .notched-outline,
      &:hover .notched-outline {
        border-color: ${tokens.text.disabled};
      }
    `}
`;

/** `content-box` + a 23px line + 16.5px of padding is what makes the field 56px. */
const Input = styled.input`
  display: block;
  box-sizing: content-box;
  width: 100%;
  min-width: 0;
  height: 1.4375em;
  margin: 0;
  padding: 16.5px 14px;
  border: 0;
  background: none;
  color: currentColor;
  font: inherit;
  letter-spacing: inherit;
  -webkit-tap-highlight-color: transparent;

  &::placeholder {
    color: currentColor;
    opacity: 0.5;
    transition: opacity 200ms ${tokens.motion.easeInOut} 0ms;
  }

  &:focus {
    outline: 0;
  }

  &:invalid {
    box-shadow: none;
  }

  &:disabled {
    opacity: 1;
    -webkit-text-fill-color: ${tokens.text.disabled};
  }

  &:-webkit-autofill {
    border-radius: inherit;
    -webkit-box-shadow: 0 0 0 100px ${tokens.mui.autofillBg} inset !important;
    -webkit-text-fill-color: ${tokens.text.primary} !important;
    caret-color: ${tokens.text.primary} !important;
    transition: background-color 9999s ease-out, color 9999s ease-out;
  }
`;

/** `top: -5px` lifts the fieldset so its top border runs through the label. */
const Fieldset = styled.fieldset`
  position: absolute;
  top: -5px;
  right: 0;
  bottom: 0;
  left: 0;
  margin: 0;
  padding: 0 8px;
  min-width: 0%;
  overflow: hidden;
  border-style: solid;
  border-width: 1px;
  border-radius: inherit;
  text-align: left;
  pointer-events: none;
`;

const Legend = styled.legend<{ $withLabel: boolean; $notched: boolean }>`
  float: unset;
  width: auto;
  padding: 0;
  overflow: hidden;

  ${(p) =>
    !p.$withLabel &&
    css`
      line-height: ${NOTCH_HEIGHT};
      transition: width 150ms ${tokens.motion.easeOut} 0ms;
    `}

  ${(p) =>
    p.$withLabel &&
    css`
      display: block;
      height: ${NOTCH_HEIGHT};
      max-width: 0.01px;
      font-size: 0.75em;
      visibility: hidden;
      white-space: nowrap;
      transition: max-width 50ms ${tokens.motion.easeOut} 0ms;

      & > span {
        display: inline-block;
        padding-left: 5px;
        padding-right: 5px;
        opacity: 0;
        visibility: visible;
      }
    `}

  ${(p) =>
    p.$notched &&
    css`
      max-width: 100%;
      transition: max-width 100ms ${tokens.motion.easeOut} 50ms;
    `}
`;

/** FormHelperText: caption type, contained margins. */
const Helper = styled.p<{ $error: boolean }>`
  margin: 3px 14px 0;
  color: ${(p) => (p.$error ? tokens.trading.short : tokens.text.secondary)};
  font-size: 0.75rem;
  font-weight: 400;
  line-height: 1.66;
  letter-spacing: 0.03333em;
  text-align: left;
`;
