import styled from "@emotion/styled";
import {
  Children,
  type ReactNode,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { tokens } from "../styles/tokens";

export type SelectChangeEvent = { target: { value: string } };

interface SelectProps {
  value: string;
  onChange: (event: SelectChangeEvent) => void;
  children: ReactNode;
  renderValue?: (value: string) => ReactNode;
  displayEmpty?: boolean;
  disabled?: boolean;
  className?: string;
  id?: string;
  /** Matches the previous MUI `FormControl fullWidth` wrapper. */
  fullWidth?: boolean;
}

interface MenuItemProps {
  value: string;
  children: ReactNode;
  className?: string;
}

export const MenuItem = (_props: MenuItemProps) => null;

function optionsOf(children: ReactNode): { value: string; node: ReactNode }[] {
  const options: { value: string; node: ReactNode }[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement<MenuItemProps>(child)) return;
    if (child.props.value == null) return;
    options.push({ value: String(child.props.value), node: child.props.children });
  });
  return options;
}

export const Select = ({
  value,
  onChange,
  children,
  renderValue,
  disabled = false,
  className,
  id,
  fullWidth = false,
}: SelectProps) => {
  const options = optionsOf(children);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [menuBox, setMenuBox] = useState({ top: 0, left: 0, width: 0 });

  const selected = options.find((option) => option.value === value);

  const toggle = () => {
    if (disabled) return;
    setOpen((was) => !was);
  };

  useEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const maxHeight = 360;
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const openUp = spaceBelow < 160 && rect.top > spaceBelow;
      setMenuBox({
        top: openUp ? Math.max(8, rect.top - Math.min(maxHeight, rect.top - 8)) : rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
    }
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onReposition = () => setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open]);

  const triggerContent = renderValue ? renderValue(value) : (selected?.node ?? (value || null));

  return (
    <Root className={className} $fullWidth={fullWidth}>
      <Trigger
        ref={triggerRef}
        type="button"
        id={id}
        className="select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={toggle}
      >
        <TriggerValue>{triggerContent}</TriggerValue>
        <Chevron aria-hidden viewBox="0 0 24 24">
          <path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" />
        </Chevron>
      </Trigger>
      {open &&
        createPortal(
          // biome-ignore lint/a11y/useSemanticElements: custom menu for a rich trigger that a native select cannot render
          <Menu
            ref={menuRef}
            id={listId}
            role="listbox"
            style={{ top: menuBox.top, left: menuBox.left, width: menuBox.width }}
          >
            {options.map((option) => (
              // biome-ignore lint/a11y/useSemanticElements: pairs with the custom listbox above
              <Option
                key={option.value}
                role="option"
                aria-selected={option.value === value}
                $selected={option.value === value}
                onClick={() => {
                  onChange({ target: { value: option.value } });
                  close();
                }}
              >
                {option.node}
              </Option>
            ))}
          </Menu>,
          document.body,
        )}
    </Root>
  );
};

const Root = styled("div")<{ $fullWidth: boolean }>`
  display: inline-flex;
  min-width: 0;
  width: ${(p) => (p.$fullWidth ? "100%" : "auto")};
`;

const Trigger = styled("button")`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  margin: 0;
  padding: 0.4rem 0.5rem 0.4rem 0.85rem;
  border: 1px solid ${tokens.overlay.white20};
  border-radius: ${tokens.radius.md};
  background: ${tokens.surface.inputIsland};
  color: ${tokens.text.onDark};
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.2s ease, border-color 0.2s ease;

  &:hover:not(:disabled) {
    background: ${tokens.surface.inputIslandHover};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const TriggerValue = styled("span")`
  display: flex;
  align-items: center;
  min-width: 0;
  flex: 1;
`;

const Chevron = styled("svg")`
  width: 1.25rem;
  height: 1.25rem;
  flex-shrink: 0;
  color: ${tokens.text.onDark};
`;

const Menu = styled("ul")`
  position: fixed;
  z-index: 1400;
  margin: 0;
  padding: 0.25rem 0;
  list-style: none;
  max-height: 360px;
  overflow: auto;
  background: ${tokens.surface.card};
  color: ${tokens.text.onDark};
  border: 1px solid ${tokens.border.default};
  border-radius: ${tokens.radius.md};
  box-shadow: ${tokens.shadow.level3};
`;

const Option = styled("li")<{ $selected: boolean }>`
  display: flex;
  align-items: center;
  padding: 0.5rem 0.85rem;
  font-size: 0.875rem;
  cursor: pointer;
  background: ${(p) => (p.$selected ? tokens.overlay.white08 : "transparent")};

  &:hover {
    background: ${tokens.overlay.white10};
  }
`;
