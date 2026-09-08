"use client";

import { useRef, useState } from 'react';
import { Copy, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

const APP_URL = 'https://scan-and-send-tau.vercel.app';

export function ShareApp() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const sharing = useRef(false);
  const link = useRef<HTMLInputElement>(null);

  const share = async () => {
    if (sharing.current) return;
    sharing.current = true; setBusy(true); setNotice('');
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Scan and Send', text: 'Transformez vos documents en PDF avec Scan and Send.', url: APP_URL });
      } else setOpen(true);
    } catch (cause) {
      if (!(cause instanceof Error && cause.name === 'AbortError')) setOpen(true);
    } finally { sharing.current = false; setBusy(false); }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(APP_URL);
      setNotice('Lien copié. Vous pouvez le coller dans un message.');
    } catch {
      link.current?.focus(); link.current?.select();
      setNotice('Copiez le lien sélectionné, puis collez-le dans votre message.');
    }
  };

  return <>
    <Button variant="ghost" className="share-app-button" disabled={busy} onClick={share}><Share2 />Partager l’app</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="mail-dialog" showCloseButton={false}>
        <DialogTitle>Partager Scan and Send</DialogTitle>
        <DialogDescription>Envoyez ce lien pour faire découvrir l’application.</DialogDescription>
        <Input ref={link} value={APP_URL} readOnly aria-label="Lien de l’application" onFocus={event => event.target.select()} />
        <div className="dialog-actions">
          <Button className="action" onClick={copy}><Copy />Copier le lien</Button>
          <DialogClose render={<Button variant="ghost" className="action" />}>Fermer</DialogClose>
        </div>
        {notice && <p role="status">{notice}</p>}
      </DialogContent>
    </Dialog>
  </>;
}
