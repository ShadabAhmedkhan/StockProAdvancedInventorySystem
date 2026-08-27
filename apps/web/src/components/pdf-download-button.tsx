'use client';

import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface PdfDownloadButtonProps {
  onDownload: () => void;
  disabled?: boolean;
}

export function PdfDownloadButton({ onDownload, disabled }: PdfDownloadButtonProps): React.JSX.Element {
  return (
    <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onDownload}>
      <Download className="h-3.5 w-3.5" />
      Download PDF
    </Button>
  );
}
