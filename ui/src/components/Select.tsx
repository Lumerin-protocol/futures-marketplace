import styled from "@emotion/styled";
import {
  Children,
  type KeyboardEvent,
  type ReactNode,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
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

/** Popover's `marginThreshold`: how close to the viewport edge the paper may sit. */
const MARGIN_THRESHOLD_PX = 16;
/**
 * Popover runs Grow on `timeout="auto"`, which works out at roughly this for a
 * menu a few rows tall — `transitions.duration.short`.
 */
const TRANSITION_MS = 250;

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
  const paperRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLLIElement | null)[]>([]);
  const exitTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const listId = useId();

  // `isOpen` is the logical state, `mounted` holds the paper in the tree through
  // its exit transition, and `entered` is the flag the transition runs off.
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [entered, setEntered] = useState(false);
  const [box, setBox] = useState({ top: 0, left: 0, minWidth: 0 });

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex === -1 ? undefined : options[selectedIndex];

  const open = useCallback(() => {
    if (disabled) return;
    clearTimeout(exitTimer.current);
    setIsOpen(true);
    setMounted(true);
  }, [disabled]);

  const close = useCallback((restoreFocus = false) => {
    clearTimeout(exitTimer.current);
    setIsOpen(false);
    setEntered(false);
    exitTimer.current = setTimeout(() => setMounted(false), TRANSITION_MS);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => () => clearTimeout(exitTimer.current), []);

  useLayoutEffect(() => {
    const paper = paperRef.current;
    const anchor = triggerRef.current?.getBoundingClientRect();
    if (!mounted || !paper || !anchor) return;

    // The paper is still scaled down by the enter transform, so go through the
    // layout box rather than the client rect. The floor is the trigger's width,
    // which has not been applied yet on this first pass.
    const width = Math.max(paper.offsetWidth, anchor.width);
    const height = paper.offsetHeight;

    // MUI anchors the menu bottom-centre to top-centre, then Popover shifts it
    // back inside the viewport instead of flipping it.
    const left = anchor.left + anchor.width / 2 - width / 2;
    const maxLeft = window.innerWidth - width - MARGIN_THRESHOLD_PX;
    const maxTop = window.innerHeight - height - MARGIN_THRESHOLD_PX;

    setBox({
      top: Math.min(Math.max(MARGIN_THRESHOLD_PX, anchor.bottom), Math.max(MARGIN_THRESHOLD_PX, maxTop)),
      left: Math.min(Math.max(MARGIN_THRESHOLD_PX, left), Math.max(MARGIN_THRESHOLD_PX, maxLeft)),
      minWidth: anchor.width,
    });
  }, [mounted]);

  // Grow starts once the paper has been placed, and the selected row takes
  // focus the way MUI's `variant="selectedMenu"` MenuList does.
  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => {
      setEntered(true);
      const target = optionRefs.current[selectedIndex === -1 ? 0 : selectedIndex];
      target?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen, selectedIndex]);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || paperRef.current?.contains(target)) return;
      close();
    };
    const onReposition = () => close();
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [isOpen, close]);

  const pick = (next: string) => {
    onChange({ target: { value: next } });
    close(true);
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === " ") {
      event.preventDefault();
      open();
    }
  };

  const focusOption = (index: number) => {
    const clamped = Math.min(Math.max(0, index), options.length - 1);
    optionRefs.current[clamped]?.focus();
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const current = optionRefs.current.findIndex((node) => node === document.activeElement);
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusOption(current + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusOption(current - 1);
        break;
      case "Home":
        event.preventDefault();
        focusOption(0);
        break;
      case "End":
        event.preventDefault();
        focusOption(options.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (current !== -1) pick(options[current].value);
        break;
      case "Escape":
        event.preventDefault();
        close(true);
        break;
      // MUI's Menu swallows Tab and closes rather than letting focus walk the
      // list, since the list lives in a portal at the end of the document.
      case "Tab":
        event.preventDefault();
        close(true);
        break;
      default:
        break;
    }
  };

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
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
        onClick={() => (isOpen ? close() : open())}
        onKeyDown={onTriggerKeyDown}
      >
        <TriggerValue>{triggerContent}</TriggerValue>
        <Icon aria-hidden viewBox="0 0 24 24" $open={isOpen}>
          <path d="M7 10l5 5 5-5z" />
        </Icon>
      </Trigger>
      {mounted &&
        createPortal(
          <Paper
            ref={paperRef}
            $entered={entered}
            style={{ top: box.top, left: box.left, minWidth: box.minWidth }}
          >
            {/* biome-ignore lint/a11y/useSemanticElements: custom menu for a rich trigger that a native select cannot render */}
            <List id={listId} role="listbox" onKeyDown={onListKeyDown}>
              {options.map((option, index) => (
                // biome-ignore lint/a11y/useSemanticElements: pairs with the custom listbox above
                <Option
                  key={option.value}
                  ref={(node) => {
                    optionRefs.current[index] = node;
                  }}
                  role="option"
                  tabIndex={-1}
                  aria-selected={option.value === value}
                  $selected={option.value === value}
                  onClick={() => pick(option.value)}
                >
                  {option.node}
                </Option>
              ))}
            </List>
          </Paper>,
          document.body,
        )}
    </Root>
  );
};

const Root = styled.div<{ $fullWidth: boolean }>`
  display: inline-flex;
  min-width: 0;
  width: ${(p) => (p.$fullWidth ? "100%" : "auto")};
`;

/**
 * An OutlinedInput wearing a Select: MUI's dense outlined metrics (8.5px/14px
 * around a 1.4375em line, so the control lands on 40px) with the resting border
 * and 2px focused border the app's old `MuiOutlinedInput` override asked for.
 */
const Trigger = styled.button`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  box-sizing: border-box;
  width: 100%;
  min-height: 1.4375em;
  margin: 0;
  padding: 8.5px 14px;
  border: 1px solid ${tokens.overlay.white23};
  border-radius: ${tokens.radius.sm};
  background: ${tokens.surface.inputIsland};
  color: ${tokens.text.onDark};
  font-family: inherit;
  font-size: 1rem;
  line-height: 1.4375em;
  text-align: left;
  cursor: pointer;
  transition: background-color 150ms ${tokens.motion.easeInOut},
    border-color 150ms ${tokens.motion.easeInOut};

  &:hover:not(:disabled) {
    border-color: ${tokens.text.primary};
    background: ${tokens.surface.inputIslandHover};
  }

  /* Keyboard only. A select holds focus for as long as its menu is open and
     after a pick, so a ring on plain :focus would sit there after a click. */
  &:focus-visible {
    outline: none;
    border-color: ${tokens.brand.blue};
    box-shadow: inset 0 0 0 1px ${tokens.brand.blue};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const TriggerValue = styled.span`
  display: flex;
  align-items: center;
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

/** `ArrowDropDown` at SvgIcon's medium size, flipping over on open. */
const Icon = styled.svg<{ $open: boolean }>`
  width: 1em;
  height: 1em;
  flex-shrink: 0;
  font-size: 1.5rem;
  fill: currentColor;
  color: ${tokens.text.onDark};
  pointer-events: none;
  user-select: none;
  transition: transform 150ms ${tokens.motion.easeInOut};
  transform: ${(p) => (p.$open ? "rotate(180deg)" : "none")};
`;

/**
 * Menu's Paper: elevation 8, and the `calc(100% - 96px)` ceiling the Material
 * spec puts on a simple menu so there is always somewhere to click to dismiss.
 */
const Paper = styled.div<{ $entered: boolean }>`
  position: fixed;
  top: 0;
  left: 0;
  z-index: 1300;
  box-sizing: border-box;
  min-width: 16px;
  min-height: 16px;
  max-width: calc(100% - 32px);
  max-height: calc(100% - 96px);
  overflow-x: hidden;
  overflow-y: auto;
  outline: 0;
  background-color: ${tokens.surface.card};
  color: ${tokens.text.onDark};
  border-radius: ${tokens.radius.md};
  box-shadow: ${tokens.shadow.elevation8};
  transform-origin: top center;
  pointer-events: ${(p) => (p.$entered ? "auto" : "none")};
  opacity: ${(p) => (p.$entered ? 1 : 0)};
  transform: ${(p) => (p.$entered ? "none" : "scale(0.75, 0.5625)")};
  transition: opacity 250ms ${tokens.motion.easeInOut} 0ms,
    transform 166ms ${tokens.motion.easeInOut} 0ms;
`;

/** List's default `padding: 8px 0`, with the focus ring left to the rows. */
const List = styled.ul`
  margin: 0;
  padding: 8px 0;
  list-style: none;
  outline: 0;
`;

const Option = styled.li<{ $selected: boolean }>`
  display: flex;
  position: relative;
  align-items: center;
  justify-content: flex-start;
  box-sizing: border-box;
  padding: 6px 16px;
  font-size: 1rem;
  line-height: 1.5;
  white-space: nowrap;
  text-decoration: none;
  cursor: pointer;
  user-select: none;
  outline: 0;
  background-color: ${(p) => (p.$selected ? tokens.neutralButton.selected : "transparent")};

  &:hover {
    background-color: ${(p) => (p.$selected ? tokens.neutralButton.selectedHover : tokens.overlay.white08)};
  }

  &:focus-visible {
    background-color: ${(p) => (p.$selected ? tokens.neutralButton.selectedFocus : tokens.overlay.white12)};
  }

  /* Material drops the 48px minimum once there is room for a pointer. */
  @media (max-width: 599px) {
    min-height: 48px;
  }
`;
