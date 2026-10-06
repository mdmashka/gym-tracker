import { createRoot } from 'react-dom/client';
import { App } from './main';
import { applyAppearance, readAppearance } from './appearance';
import './apple-design.css';

applyAppearance(readAppearance());

createRoot(document.getElementById('root')!).render(<App/>);
