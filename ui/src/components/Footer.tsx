import { faFacebookF } from "@fortawesome/free-brands-svg-icons/faFacebookF";
import { faRedditAlien } from "@fortawesome/free-brands-svg-icons/faRedditAlien";
import { faXTwitter } from "@fortawesome/free-brands-svg-icons/faXTwitter";
import { faYoutube } from "@fortawesome/free-brands-svg-icons/faYoutube";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import FlagCircleIcon from "@mui/icons-material/FlagCircle";
import HelpIcon from "@mui/icons-material/Help";
import ShieldIcon from "@mui/icons-material/Shield";
import styled from "@mui/material/styles/styled";
import { tokens } from "../styles/tokens";

const socials = [
  { label: "Facebook", link: "https://www.facebook.com/share/1J74GJvw5W/?mibextid=wwXIfr", icon: faFacebookF },
  { label: "Reddit", link: "https://www.reddit.com/r/HPDX/", icon: faRedditAlien },
  { label: "X", link: "https://x.com/HashPowerDEX", icon: faXTwitter },
  { label: "YouTube", link: "https://www.youtube.com/channel/UCSCjcUgrIklzUREpD39z7og", icon: faYoutube },
];

const resources = [
  { href: `${process.env.REACT_APP_GITBOOK_URL}`, icon: HelpIcon, label: "Help" },
  { href: "https://github.com/Lumerin-protocol/futures-marketplace/issues", icon: FlagCircleIcon, label: "Report issue" },
  { href: "", icon: ShieldIcon, label: "Privacy Policy" },
];

export const Footer = () => {
  return (
    <FooterWrapper>
      <FooterContent>
        <LeftSection>
          <LinksRow>
            {resources.map((item) => (
              <ResourceLink
                href={item.href}
                target={item.href ? "_blank" : undefined}
                rel={item.href ? "noreferrer" : undefined}
                aria-disabled={!item.href}
                $disabled={!item.href}
                onClick={item.href ? undefined : (event) => event.preventDefault()}
                key={item.label}
              >
                <item.icon style={{ fill: tokens.accent.main, fontSize: "20px" }} />
                <span>{item.label}</span>
              </ResourceLink>
            ))}
          </LinksRow>
          <VersionText>Version: {process.env.REACT_APP_VERSION}</VersionText>
        </LeftSection>

        <RightSection>
          <SocialsRow>
            {socials.map((item) => (
              <SocialLink
                href={item.link}
                target="_blank"
                rel="noreferrer"
                aria-label={item.label}
                key={item.label}
              >
                <FontAwesomeIcon icon={item.icon} />
              </SocialLink>
            ))}
          </SocialsRow>
        </RightSection>
      </FooterContent>
    </FooterWrapper>
  );
};

const FooterWrapper = styled("footer")`
  width: 100%;
  margin-top: auto;
  padding: 2rem 0;
`;

const FooterContent = styled("div")`
  max-width: 1920px;
  margin: 0 auto;
  padding: 0 1.5rem;
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-start;
  gap: 2rem;

  @media (max-width: 768px) {
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
`;

const _SectionTitle = styled("h3")`
  color: ${tokens.text.onDark};
  font-size: 0.875rem;
  font-weight: 600;
  margin-bottom: 1rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
`;

const LeftSection = styled("div")`
  display: flex;
  flex-direction: column;
`;

const LinksRow = styled("div")`
  display: flex;
  gap: 1.5rem;
  flex-wrap: wrap;

  @media (max-width: 768px) {
    justify-content: center;
  }
`;

const ResourceLink = styled("a")<{ $disabled: boolean }>`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: ${tokens.text.footerStrong};
  text-decoration: none;
  font-size: 0.875rem;
  transition: color 0.2s ease;
  opacity: ${(props) => (props.$disabled ? 0.4 : 1)};
  cursor: ${(props) => (props.$disabled ? "default" : "pointer")};

  &:hover:not([aria-disabled="true"]) {
    color: ${tokens.accent.mainLower};
  }
`;

const RightSection = styled("div")`
  display: flex;
  flex-direction: column;
  align-items: flex-end;

  @media (max-width: 768px) {
    align-items: center;
    width: 100%;
  }
`;

const SocialsRow = styled("div")`
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 1rem;
  max-width: 100%;

  @media (max-width: 768px) {
    justify-content: center;
  }
`;

const SocialLink = styled("a")`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: ${tokens.overlay.white10};
  color: ${tokens.text.onDark};
  font-size: 1.125rem;
  transition: all 0.2s ease;

  &:hover {
    background: ${tokens.accent.mainLower};
    transform: translateY(-2px);
  }
`;

const VersionText = styled("div")`
  font-size: 0.75rem;
  color: ${tokens.text.footerSubtle};
  margin-top: 1rem;

  @media (max-width: 768px) {
    text-align: center;
  }
`;
