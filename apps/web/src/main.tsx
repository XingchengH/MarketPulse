import React from 'react';
import ReactDOM from 'react-dom/client';
import { useEffect } from 'react';
import { Provider } from 'react-redux';
import { RouterProvider } from 'react-router-dom';
import { AuthGate } from './auth/AuthGate';
import { router } from './router';
import { store } from './store';
import { connectSocket } from './socket';
import './styles.css';

function Workspace() { useEffect(() => connectSocket(store), []); return <RouterProvider router={router}/>; }
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><Provider store={store}><AuthGate><Workspace/></AuthGate></Provider></React.StrictMode>);
