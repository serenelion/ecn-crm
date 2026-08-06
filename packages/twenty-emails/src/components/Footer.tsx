import { type I18n } from '@lingui/core';
import { Column, Container, Row } from 'react-email';
import { Link } from 'src/components/Link';
import { ShadowText } from 'src/components/ShadowText';

const footerContainerStyle = {
  marginTop: '12px',
};

type FooterProps = {
  i18n: I18n;
};

export const Footer = ({ i18n }: FooterProps) => {
  return (
    <Container style={footerContainerStyle}>
      <Row>
        <Column>
          <ShadowText>
            <Link
              href="https://www.earthcare.network"
              value={i18n._('Website')}
              aria-label={i18n._("Visit Earth Care Network's website")}
            />
          </ShadowText>
        </Column>
        <Column>
          <ShadowText>
            <Link
              href="https://github.com/serenelion/ecn-crm"
              value={i18n._('Source')}
              aria-label={i18n._('View CRM source code')}
            />
          </ShadowText>
        </Column>
        <Column>
          <ShadowText>
            <Link
              href="https://www.earthcare.network"
              value={i18n._('User guide')}
              aria-label={i18n._('Read Earth Care Network documentation')}
            />
          </ShadowText>
        </Column>
        <Column>
          <ShadowText>
            <Link
              href="https://github.com/serenelion/ecn-crm"
              value={i18n._('Developers')}
              aria-label={i18n._('Visit CRM developer documentation')}
            />
          </ShadowText>
        </Column>
      </Row>
      <ShadowText>
        <>
          {i18n._('Earth Care Network — CRM (AGPL)')}
          <br />
          {i18n._('See NOTICE.ECN in source for attribution')}
        </>
      </ShadowText>
    </Container>
  );
};
