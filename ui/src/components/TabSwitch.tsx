import { styled } from "next-yak";
import { MenuItem, Select } from "./Select";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { tokens } from "../styles/tokens";

type Props<T> = {
  readonly values: readonly Value<T>[];
  value: T;
  setValue: (value: T) => void;
};

type Value<T> = {
  readonly text: string;
  readonly value: T;
  readonly count: number;
};

export const TabSwitch = <T extends string>(props: Props<T>) => {
  const { values, value, setValue } = props;
  const numTabs = values.length;
  const activeIndex = values.findIndex((v) => v.value === value);
  const isMobile = useMediaQuery("(max-width: 768px)");

  if (isMobile) {
    return (
      <MobileTabSelect
        fullWidth
        value={value}
        onChange={(e) => setValue(e.target.value as T)}
        renderValue={(selected) => {
          const v = values.find((x) => x.value === selected);
          if (!v) return null;
          return (
            <MobileTabSelectValue>
              <span>{v.text}</span>
              <MobileCountBadge>{v.count}</MobileCountBadge>
            </MobileTabSelectValue>
          );
        }}
      >
        {values.map((val) => (
          <MenuItem value={val.value} key={val.value}>
            <MobileMenuItemInner>
              <span>{val.text}</span>
              <MobileCountBadge>{val.count}</MobileCountBadge>
            </MobileMenuItemInner>
          </MenuItem>
        ))}
      </MobileTabSelect>
    );
  }

  return (
    <TabSwitchStyled $numTabs={numTabs}>
      {values.map((val) => (
        <button
          type="button"
          id={val.value}
          className={val.value === value ? "active entry" : "entry"}
          onClick={() => setValue(val.value)}
          key={val.value}
        >
          {val.text} <span>{val.count}</span>
        </button>
      ))}

      {numTabs === 2 && <span className="glider" />}
      {numTabs > 2 && <span className="multi-glider" style={{ left: `calc(${activeIndex * (100 / numTabs)}% + 3px)` }} />}
    </TabSwitchStyled>
  );
};

const MobileTabSelect = styled(Select)`
  width: 100%;
  min-width: 0;

  .select-trigger {
    border-radius: ${tokens.radius.md};
    background-color: ${tokens.surface.mobileTabBgAlpha};
    border-color: ${tokens.border.default};
    padding-top: 0.65rem;
    padding-bottom: 0.65rem;
    font-weight: 500;

    &:hover:not(:disabled) {
      border-color: ${tokens.brand.blue};
    }
  }
`;

const MobileTabSelectValue = styled.span`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 0.75rem;
  padding-right: 0.25rem;
`;

const MobileMenuItemInner = styled.span`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 0.75rem;
`;

const MobileCountBadge = styled.span`
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75em;
  min-width: 2em;
  height: 2em;
  padding: 0 0.35em;
  border-radius: ${tokens.radius.full};
  color: ${tokens.text.onLight};
  background-color: #FFFFFF;
  flex-shrink: 0;
`;

export const TabSwitchStyled = styled.div<{ $numTabs: number }>`
  display: inline-grid;
  grid-template-columns: ${(props) => `repeat(${props.$numTabs}, 1fr)`};
  align-items: center;
  border: 1px solid ${tokens.border.default};
  color: ${tokens.text.onDark};
  padding: 0.7rem 0.25rem;
  border-radius: ${tokens.radius.md};
  position: relative;

  button {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.875rem;
    font-weight: 500;
    border-radius: ${tokens.radius.full};
    cursor: pointer;
    transition: color 0.15s ease-in;
    z-index: 2;
    padding: 0.1em 0.7em;

    @media (max-width: 500px) {
      font-size: 0.75rem;
    }

    span {
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.75em;
      width: 2em;
      height: 2em;
      margin-left: 0.75em;
      border-radius: ${tokens.radius.full};
      transition: 0.15s ease-in;
      color: ${tokens.text.onLight};
      background-color: #FFFFFF;
    }
  }

  .active {
    color: white;
  }

  .entry:first-of-type.active {
    & ~ .glider {
      transform: translateX(0);
    }
  }

  .entry:last-of-type.active + .glider {
    transform: translateX(calc(100% + 6px));
  }

  .active > span {
    color: ${tokens.text.onLight};
    background-color: #FFFFFF;
  }

  .glider {
    position: absolute;
    display: flex;
    top: 3px;
    left: 3px;
    bottom: 3px;
    width: calc(50% - 6px);
    background-color: ${tokens.surface.tabActive};
    z-index: 1;
    border-radius: ${tokens.radius.sm};
    transition: 0.25s ease-out;
  }

  .multi-glider {
    position: absolute;
    display: flex;
    top: 3px;
    bottom: 3px;
    width: calc(${(props) => 100 / props.$numTabs}% - 6px);
    background-color: ${tokens.surface.tabActive};
    z-index: 1;
    border-radius: ${tokens.radius.sm};
    transition: left 0.25s ease-out;
  }
`;
