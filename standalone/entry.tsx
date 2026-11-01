import {createRoot} from 'react-dom/client';
import Home from '../app/page';
import {createLocalAPI} from './local-api';
let storage:Storage|undefined;try{storage=window.sessionStorage;}catch{/* File-origin storage may be blocked. */}
window.paperleafLocalFetch=createLocalAPI({storage});
createRoot(document.getElementById('root')!).render(<Home/>);
