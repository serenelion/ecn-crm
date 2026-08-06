import { Img } from 'react-email';

const logoStyle = {
  marginBottom: '40px',
};

export const Logo = () => {
  return (
    <Img
      src="https://www.earthcare.network/favicon.ico"
      alt="CRM logo"
      width="40"
      height="40"
      style={logoStyle}
    />
  );
};
