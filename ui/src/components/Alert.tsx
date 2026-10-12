import { tokens } from "../styles/tokens";
import { ModalBox } from "./Modal.styled";
import { Modal } from "./Modal";

interface AlertProps {
  message: string;
  isOpen: boolean;
  onClose: React.Dispatch<React.SetStateAction<boolean>>;
  onClick?: () => void;
}

export const Alert: React.FC<AlertProps> = ({ message, isOpen, onClose, onClick }) => {
  return (
    <Modal open={isOpen} onClose={() => onClose(false)}>
      <ModalBox
        style={{
          margin: "3rem auto",
          borderRadius: 8,
          backgroundColor: tokens.modal.bg,
          border: `1px solid ${tokens.border.default}`,
        }}
      >
        <div className="modal-card">
          <button
            type="button"
            style={{ background: tokens.surface.alert, color: tokens.text.onDark, borderRadius: tokens.radius.sm }}
            className="inline-flex justify-center w-full text-base font-medium"
            onClick={onClick ? () => onClick() : () => {}}
          >
            <h3 className="text-md font-medium">{message}</h3>
          </button>
        </div>
      </ModalBox>
    </Modal>
  );
};

Alert.displayName = "Alert";
