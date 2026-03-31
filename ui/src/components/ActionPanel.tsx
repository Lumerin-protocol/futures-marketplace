interface ActionPanelProps {
  button: JSX.Element;
  headerText: string;
  paragraphText: string | null;
}

export const ActionPanel: React.FC<ActionPanelProps> = ({ button, headerText, paragraphText }) => {
  return (
    <div className="flex flex-col w-1/5 items-center w=3/6 bg-[#1A1D28] shadow-hpdx-2 rounded-lg m-auto mt-36 border border-[#2E3348]">
      <div className="flex flex-col items-center px-4 py-5">
        <h3 className="text-lg leading-6 font-medium text-[#E2E8F0]">{headerText}</h3>
        {paragraphText && <p className="mt-2 text-center text-sm text-[#94A3B8]">{paragraphText}</p>}
      </div>
      {button}
    </div>
  );
};

ActionPanel.displayName = "ActionPanel";
