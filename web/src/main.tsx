import { createRoot } from 'react-dom/client';
import './index.css';
import { Page, type PageKind } from './Page';

const kind = (document.documentElement.dataset.page ?? 'home') as PageKind;
createRoot(document.getElementById('root')!).render(<Page kind={kind} />);
