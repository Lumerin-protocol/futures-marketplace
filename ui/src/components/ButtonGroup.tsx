import type { ReactElement } from "react";
import { FormButtonsWrapper } from "./Forms/FormButtons/Buttons.styled";

interface ButtonGroupProps {
  button1: ReactElement;
  button2: ReactElement;
}
export const ButtonGroup: React.FC<ButtonGroupProps> = ({ button1, button2 }) => {
  return (
    <FormButtonsWrapper>
      {button1}
      {button2}
    </FormButtonsWrapper>
  );
};

ButtonGroup.displayName = "ButtonGroup";
