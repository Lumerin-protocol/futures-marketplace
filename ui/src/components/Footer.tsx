import { faDiscord } from "@fortawesome/free-brands-svg-icons/faDiscord";
import { faMedium } from "@fortawesome/free-brands-svg-icons/faMedium";
import { faTelegram } from "@fortawesome/free-brands-svg-icons/faTelegram";
import { faTiktok } from "@fortawesome/free-brands-svg-icons/faTiktok";
import { faXTwitter } from "@fortawesome/free-brands-svg-icons/faXTwitter";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import FlagCircleIcon from "@mui/icons-material/FlagCircle";
import HelpIcon from "@mui/icons-material/Help";
import ShieldIcon from "@mui/icons-material/Shield";
import styled from "@mui/material/styles/styled";

const socials = [
  { link: "https://discord.gg/lumerin", icon: faDiscord },
  { link: "https://titanmining.medium.com", icon: faMedium },
  { link: "https://t.me/LumerinOfficial", icon: faTelegram },
  { link: "http://twitter.com/hellolumerin", icon: faXTwitter },
  { link: "https://www.tiktok.com/@hellolumerin_", icon: faTiktok },
];

const resources = [
  { href: `${process.env.REACT_APP_GITBOOK_URL}`, icon: HelpIcon, label: "Help" },
  { href: "https://github.com/Lumerin-protocol/proxy-router-ui/issues", icon: FlagCircleIcon, label: "Report issue" },
  { href: "https://lumerin.io/privacy-policy", icon: ShieldIcon, label: "Privacy Policy" },
];

export const Footer = () => {
  return (
    <FooterWrapper>
      <FooterContent>
        <LeftSection>
          <LinksRow>
            {resources.map((item) => (
              <ResourceLink href={item.href} target="_blank" rel="noreferrer" key={item.label}>
                <item.icon style={{ fill: "#509EBA", fontSize: "20px" }} />
                <span>{item.label}</span>
              </ResourceLink>
            ))}
          </LinksRow>
          <VersionText>Version: {process.env.REACT_APP_VERSION}</VersionText>
        </LeftSection>

        <RightSection>
          <SocialsRow>
            {socials.map((item) => (
              <SocialLink href={item.link} target="_blank" rel="noreferrer" key={item.link}>
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
//   background: linear-gradient(180deg, rgba(79, 126, 145, 0.08) 0%, rgba(79, 126, 145, 0.02) 100%);
//   border-top: 1px solid rgba(171, 171, 171, 0.3);
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

const SectionTitle = styled("h3")`
  color: #fff;
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

const ResourceLink = styled("a")`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: rgba(255, 255, 255, 0.8);
  text-decoration: none;
  font-size: 0.875rem;
  transition: color 0.2s ease;

  &:hover {
    color: #509eba;
  }
`;

const RightSection = styled("div")`
  display: flex;
  flex-direction: column;
  align-items: flex-end;

  @media (max-width: 768px) {
    align-items: center;
  }
`;

const SocialsRow = styled("div")`
  display: flex;
  gap: 1rem;
`;

const SocialLink = styled("a")`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  font-size: 1.125rem;
  transition: all 0.2s ease;

  &:hover {
    background: #509eba;
    transform: translateY(-2px);
  }
`;

const VersionText = styled("div")`
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.5);
  margin-top: 1rem;

  @media (max-width: 768px) {
    text-align: center;
  }
`;
