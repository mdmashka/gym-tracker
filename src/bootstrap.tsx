import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './main';
import { LinkConfirmation, linkParameter } from './link-confirmation';
function Entry() {
  const [linking, setLinking] = useState(() => linkParameter().startsWith('link_'));
  return linking ? <LinkConfirmation onCancel={() => setLinking(false)} /> : <App />;
}
createRoot(document.getElementById('root')!).render(<Entry />);
