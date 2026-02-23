import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageSquare, Upload, FileArchive } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export function FeedbackCard() {
  const { t } = useTranslation('settings')
  const [exportStatus, setExportStatus] = useState<string | null>(null)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)

  useEffect(() => {
    const unsub1 = window.electronApi.on('feedback:exportStatus', (data) => {
      setExportStatus(data.message)
    })
    const unsub2 = window.electronApi.on('feedback:uploadStatus', (data) => {
      setUploadStatus(data.message)
    })
    return () => {
      unsub1()
      unsub2()
    }
  }, [])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          {t('feedback.title')}
        </CardTitle>
        <CardDescription>{t('feedback.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.electronApi.send('feedback:exportSamples')}
          >
            <FileArchive className="h-4 w-4 mr-1" />
            {t('feedback.exportButton')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.electronApi.send('feedback:uploadSamples')}
          >
            <Upload className="h-4 w-4 mr-1" />
            {t('feedback.uploadButton')}
          </Button>
        </div>
        {exportStatus && (
          <p className="text-sm text-muted-foreground">{exportStatus}</p>
        )}
        {uploadStatus && (
          <p className="text-sm text-muted-foreground">{uploadStatus}</p>
        )}
      </CardContent>
    </Card>
  )
}
