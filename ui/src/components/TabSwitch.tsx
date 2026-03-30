import FormControl from "@mui/material/FormControl";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import styled from "@mui/material/styles/styled";
import useMediaQuery from "@mui/material/useMediaQuery";
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
  const isMobile = useMediaQuery("(max-width: 768px)", { noSsr: true });

  if (isMobile) {
    return (
      <MobileTabSelectWrap fullWidth size="small">
        <MobileTabSelect
          value={value}
          onChange={(e) => setValue(e.target.value as T)}
          displayEmpty
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
          MenuProps={{
            PaperProps: {
              sx: {
                bgcolor: tokens.surface.mobileTabBg,
                color: tokens.text.onDark,
                border: `1px solid ${tokens.border.muted06}`,
                borderRadius: "9px",
                maxHeight: 320,
              },
            },
          }}
        >
          {values.map((val) => (
            <MenuItem value={val.value} key={val.value} sx={{ fontSize: "0.95rem" }}>
              <MobileMenuItemInner>
                <span>{val.text}</span>
                <MobileCountBadge>{val.count}</MobileCountBadge>
              </MobileMenuItemInner>
            </MenuItem>
          ))}
        </MobileTabSelect>
      </MobileTabSelectWrap>
    );
  }

  if (isMobile) {
    return (
      <MobileTabSelectWrap fullWidth size="small">
        <MobileTabSelect
          value={value}
          onChange={(e) => setValue(e.target.value as T)}
          displayEmpty
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
          MenuProps={{
            PaperProps: {
              sx: {
                bgcolor: "#2f3639",
                color: "#fff",
                border: "1px solid rgba(171, 171, 171, 0.6)",
                borderRadius: "9px",
                maxHeight: 320,
              },
            },
          }}
        >
          {values.map((val) => (
            <MenuItem value={val.value} key={val.value} sx={{ fontSize: "0.95rem" }}>
              <MobileMenuItemInner>
                <span>{val.text}</span>
                <MobileCountBadge>{val.count}</MobileCountBadge>
              </MobileMenuItemInner>
            </MenuItem>
          ))}
        </MobileTabSelect>
      </MobileTabSelectWrap>
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

const MobileTabSelectWrap = styled(FormControl)`
  width: 100%;
  min-width: 0;
`;

const MobileTabSelect = styled(Select)`
  border-radius: 9px;

  & .MuiOutlinedInput-root {
    border-radius: 9px;
    background-color: ${tokens.surface.mobileTabBgAlpha};
  }

  & .MuiOutlinedInput-notchedOutline {
    border-color: ${tokens.border.default};
  }

  &:hover .MuiOutlinedInput-notchedOutline {
    border-color: ${tokens.border.default};
  }

  &.Mui-focused .MuiOutlinedInput-notchedOutline {
    border-color: ${tokens.surface.tabActive};
    border-width: 1px;
  }

  & .MuiSelect-select {
    display: flex;
    align-items: center;
    padding-top: 0.65rem;
    padding-bottom: 0.65rem;
    color: ${tokens.text.onDark};
    font-weight: 500;
  }

  & .MuiSvgIcon-root {
    color: ${tokens.text.onDarkMuted};
  }
`;

const MobileTabSelectValue = styled("span")`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 0.75rem;
  padding-right: 0.25rem;
`;

const MobileMenuItemInner = styled("span")`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 0.75rem;
`;

const MobileCountBadge = styled("span")`
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75em;
  min-width: 2em;
  height: 2em;
  padding: 0 0.35em;
  border-radius: 50%;
  color: ${tokens.surface.tabActive};
  background-color: ${tokens.surface.inputIsland};
  flex-shrink: 0;
`;

export const TabSwitchStyled = styled("div")<{ $numTabs: number }>`
  display: inline-grid;
  grid-template-columns: ${(props) => `repeat(${props.$numTabs}, 1fr)`};
  align-items: center;
  border: ${tokens.border.default} 1px solid;
  color: ${tokens.text.onDark};
  padding: 0.7rem 0.25rem;
  border-radius: 9px;
  position: relative;

  button {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1rem;
    font-weight: 500;
    border-radius: 99px;
    cursor: pointer;
    transition: color 0.15s ease-in;
    z-index: 2;
    padding: 0.1em 0.7em;

    @media (max-width: 500px) {
      font-size: 0.8em;
    }

    span {
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.75em;
      width: 2em;
      height: 2em;
      margin-left: 0.75em;
      border-radius: 50%;
      transition: 0.15s ease-in;
      color: ${tokens.surface.tabActive};
      background-color: ${tokens.surface.inputIsland};
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
    color: ${tokens.surface.tabActive};
    background-color: ${tokens.surface.inputIsland};
  }

  /* Original glider for 2-tab layout */
  .glider {
    position: absolute;
    display: flex;
    top: 3px;
    left: 3px;
    bottom: 3px;
    width: calc(50% - 6px);
    background-color: ${tokens.surface.tabActive};
    z-index: 1;
    border-radius: 7px;
    transition: 0.25s ease-out;
  }

  /* Multi-glider for 3+ tabs */
  .multi-glider {
    position: absolute;
    display: flex;
    top: 3px;
    bottom: 3px;
    width: calc(${(props) => 100 / props.$numTabs}% - 6px);
    background-color: ${tokens.surface.tabActive};
    z-index: 1;
    border-radius: 7px;
    transition: left 0.25s ease-out;
  }
`;
