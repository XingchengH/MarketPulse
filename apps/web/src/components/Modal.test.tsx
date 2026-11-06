import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Modal } from './Modal';
function Fixture(){const[open,setOpen]=useState(false);return <><button onClick={()=>setOpen(true)}>Open details</button>{open&&<Modal title="Details" onClose={()=>setOpen(false)}><button>Inside action</button></Modal>}</>}
describe('Modal',()=>{it('closes on Escape/cancel and returns focus to the opener',async()=>{render(<Fixture/>);const opener=screen.getByRole('button',{name:'Open details'});await userEvent.click(opener);const dialog=screen.getByRole('dialog');expect(dialog).toHaveAttribute('aria-modal','true');fireEvent(dialog,new Event('cancel',{cancelable:true}));expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(opener).toHaveFocus();});});
