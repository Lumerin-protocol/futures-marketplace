import { css, styled } from "next-yak";
import { type InputHTMLAttributes, forwardRef } from "react";
import { tokens } from "../styles/tokens";

type Native = Omit<InputHTMLAttributes<HTMLInputElement>, "size">;

interface TextFieldProps extends Native {
  label?: string;
  error?: boolean;
  helperText?: string;
  fullWidth?: boolean;
  inputProps?: Native;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  ({ label, error = false, helperText, fullWidth = false, id, className, inputProps, ...rest }, ref) => {
    return (
      <Field $fullWidth={fullWidth} className={className}>
        {label && <Label htmlFor={id}>{label}</Label>}
        <Input ref={ref} id={id} aria-invalid={error} $error={error} {...inputProps} {...rest} />
        {helperText && <Helper $error={error}>{helperText}</Helper>}
      </Field>
    );
  },
);

TextField.displayName = "TextField";

const Field = styled.div<{ $fullWidth: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 0;
  width: ${(p) => (p.$fullWidth ? "100%" : "auto")};
  ${(p) =>
    p.$fullWidth &&
    css`
      flex: 1;
    `};
`;

const Label = styled.label`
  font-size: 0.875rem;
  font-weight: 500;
  color: ${tokens.text.secondary};
`;

const Input = styled.input<{ $error: boolean }>`
  box-sizing: border-box;
  height: 56px;
  width: 100%;
  padding: 0 0.875rem;
  border: 1px solid ${(p) => (p.$error ? tokens.trading.short : tokens.border.default)};
  border-radius: ${tokens.radius.sm};
  background: ${tokens.surface.inputIsland};
  color: ${tokens.text.primary};
  font: inherit;
  font-size: 1rem;

  &:hover {
    border-color: ${(p) => (p.$error ? tokens.trading.short : tokens.brand.blue)};
  }

  &:focus {
    outline: none;
    border-color: ${(p) => (p.$error ? tokens.trading.short : tokens.brand.blue)};
    border-width: 2px;
    padding: 0 calc(0.875rem - 1px);
  }

  &:-webkit-autofill {
    -webkit-box-shadow: 0 0 0 100px ${tokens.mui.autofillBg} inset !important;
    -webkit-text-fill-color: ${tokens.text.primary} !important;
    caret-color: ${tokens.text.primary} !important;
  }
`;

const Helper = styled.p<{ $error: boolean }>`
  margin: 0;
  min-height: 1.25rem;
  font-size: 0.75rem;
  color: ${(p) => (p.$error ? tokens.trading.short : tokens.text.secondary)};
`;
