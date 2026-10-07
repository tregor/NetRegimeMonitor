import { render } from 'preact';
import App from './app.jsx';
import './styles.css';
import { registerSW } from './register-sw.js';

render(<App />, document.getElementById('root'));
registerSW();
