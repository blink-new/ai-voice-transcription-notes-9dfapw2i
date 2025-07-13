import { useState, useEffect, useRef } from 'react'
import { 
  Mic, 
  MicOff, 
  Play, 
  Pause, 
  Square, 
  Copy, 
  Download, 
  Trash2, 
  Menu,
  X,
  Volume2,
  FileText,
  Sparkles,
  Clock,
  Settings,
  MoreVertical,
  Check,
  AlertCircle
} from 'lucide-react'
import { Button } from './components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card'
import { Badge } from './components/ui/badge'
import { Switch } from './components/ui/switch'
import { Separator } from './components/ui/separator'
import { ScrollArea } from './components/ui/scroll-area'
import { Sheet, SheetContent, SheetTrigger } from './components/ui/sheet'
import { useToast } from './hooks/use-toast'
import { Toaster } from './components/ui/toaster'
import blink from './blink/client'

interface Note {
  id: string
  title: string
  content: string
  originalTranscript: string
  isGrammarCorrected: boolean
  createdAt: string
  duration: number
}

interface AudioVisualizerProps {
  isRecording: boolean
}

function AudioVisualizer({ isRecording }: AudioVisualizerProps) {
  if (!isRecording) return null

  return (
    <div className="audio-wave">
      {[...Array(7)].map((_, i) => (
        <div key={i} className="wave-bar" />
      ))}
    </div>
  )
}

function App() {
  const { toast } = useToast()
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [isRecording, setIsRecording] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [notes, setNotes] = useState<Note[]>([])
  const [currentTranscript, setCurrentTranscript] = useState('')
  const [grammarCorrection, setGrammarCorrection] = useState(true)
  const [recordingTime, setRecordingTime] = useState(0)
  const [selectedNote, setSelectedNote] = useState<Note | null>(null)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  // Auth state management
  useEffect(() => {
    const unsubscribe = blink.auth.onAuthStateChanged((state) => {
      setUser(state.user)
      setLoading(state.isLoading)
    })
    return unsubscribe
  }, [])

  // Load notes when user is authenticated
  useEffect(() => {
    if (user) {
      loadNotes()
    }
  }, [user])

  const loadNotes = async () => {
    try {
      const notesData = await blink.db.notes.list({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' }
      })
      setNotes(notesData)
    } catch (error) {
      console.error('Failed to load notes:', error)
      toast({
        title: "Error",
        description: "Failed to load notes",
        variant: "destructive"
      })
    }
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' })
        await transcribeAudio(audioBlob)
        stream.getTracks().forEach(track => track.stop())
      }

      mediaRecorder.start()
      setIsRecording(true)
      setRecordingTime(0)

      // Start timer
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1)
      }, 1000)

      toast({
        title: "Recording started",
        description: "Speak clearly into your microphone"
      })
    } catch (error) {
      console.error('Failed to start recording:', error)
      toast({
        title: "Microphone Access Required",
        description: "Please allow microphone access to record audio",
        variant: "destructive"
      })
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      setIsPaused(false)
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
      toast({
        title: "Processing audio...",
        description: "Converting your speech to text"
      })
    }
  }

  const pauseRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      if (isPaused) {
        mediaRecorderRef.current.resume()
        setIsPaused(false)
        // Resume timer
        timerRef.current = setInterval(() => {
          setRecordingTime(prev => prev + 1)
        }, 1000)
        toast({
          title: "Recording resumed"
        })
      } else {
        mediaRecorderRef.current.pause()
        setIsPaused(true)
        if (timerRef.current) {
          clearInterval(timerRef.current)
        }
        toast({
          title: "Recording paused"
        })
      }
    }
  }

  const transcribeAudio = async (audioBlob: Blob) => {
    setIsTranscribing(true)
    try {
      // Convert blob to base64
      const base64Audio = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = reader.result as string
          const base64Data = dataUrl.split(',')[1]
          resolve(base64Data)
        }
        reader.onerror = reject
        reader.readAsDataURL(audioBlob)
      })

      // Transcribe audio
      const { text } = await blink.ai.transcribeAudio({
        audio: base64Audio,
        language: 'en'
      })

      let finalText = text
      
      // Apply grammar correction if enabled
      if (grammarCorrection && text.trim()) {
        const { text: correctedText } = await blink.ai.generateText({
          prompt: `Please improve the grammar, punctuation, and clarity of this transcribed text while preserving the original meaning and tone. Return only the corrected text without any additional commentary:\n\n"${text}"`
        })
        finalText = correctedText
      }

      // Save note
      const note: Note = {
        id: `note_${Date.now()}`,
        title: finalText.slice(0, 50) + (finalText.length > 50 ? '...' : ''),
        content: finalText,
        originalTranscript: text,
        isGrammarCorrected: grammarCorrection,
        createdAt: new Date().toISOString(),
        duration: recordingTime
      }

      await blink.db.notes.create({
        id: note.id,
        userId: user.id,
        title: note.title,
        content: note.content,
        originalTranscript: note.originalTranscript,
        isGrammarCorrected: note.isGrammarCorrected ? "1" : "0",
        createdAt: note.createdAt,
        duration: note.duration
      })

      setCurrentTranscript(finalText)
      setNotes(prev => [note, ...prev])
      toast({
        title: "Transcription complete",
        description: "Your voice note has been saved"
      })

    } catch (error) {
      console.error('Transcription failed:', error)
      toast({
        title: "Transcription failed",
        description: "Failed to process your audio",
        variant: "destructive"
      })
    } finally {
      setIsTranscribing(false)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    toast({
      title: "Copied!",
      description: "Text copied to clipboard"
    })
  }

  const downloadNote = (note: Note) => {
    const element = document.createElement('a')
    const file = new Blob([note.content], { type: 'text/plain' })
    element.href = URL.createObjectURL(file)
    element.download = `${note.title.replace(/[^a-z0-9]/gi, '_')}.txt`
    document.body.appendChild(element)
    element.click()
    document.body.removeChild(element)
    toast({
      title: "Download started",
      description: "Your note is being downloaded"
    })
  }

  const deleteNote = async (noteId: string) => {
    try {
      await blink.db.notes.delete(noteId)
      setNotes(prev => prev.filter(note => note.id !== noteId))
      if (selectedNote?.id === noteId) {
        setSelectedNote(null)
      }
      toast({
        title: "Note deleted"
      })
    } catch (error) {
      console.error('Failed to delete note:', error)
      toast({
        title: "Error",
        description: "Failed to delete note",
        variant: "destructive"
      })
    }
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center space-y-4">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-muted-foreground">Loading your voice notes...</p>
        </div>
      </div>
    )
  }

  // Authentication state
  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md shadow-medium">
          <CardContent className="pt-8 pb-8">
            <div className="text-center space-y-6">
              <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto">
                <Mic className="w-8 h-8 text-primary" />
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl font-semibold text-foreground">AI Voice Notes</h1>
                <p className="text-muted-foreground">Transform your voice into perfect text notes</p>
              </div>
              <Button 
                onClick={() => blink.auth.login()} 
                className="w-full mobile-touch-target"
                size="lg"
              >
                Get Started
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // NotesPanel component for sidebar/sheet
  const NotesPanel = () => (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b bg-muted/30">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground">Notes</h3>
          <Badge variant="outline" className="text-xs">
            {notes.length}
          </Badge>
        </div>
      </div>
      <ScrollArea className="flex-1">
        {notes.length === 0 ? (
          <div className="p-6 text-center">
            <FileText className="w-10 h-10 mx-auto mb-3 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground mb-1">No notes yet</p>
            <p className="text-xs text-muted-foreground">Start recording to create your first note</p>
          </div>
        ) : (
          <div className="p-2 space-y-2">
            {notes.map((note) => (
              <div
                key={note.id}
                className={`p-3 rounded-lg border cursor-pointer transition-all hover:shadow-soft ${
                  selectedNote?.id === note.id 
                    ? 'bg-primary/5 border-primary/20' 
                    : 'bg-card hover:bg-muted/30'
                }`}
                onClick={() => {
                  setSelectedNote(note)
                  setIsSidebarOpen(false) // Close sidebar on mobile
                }}
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="font-medium text-sm leading-tight truncate flex-1">
                      {note.title}
                    </h4>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 hover:bg-muted"
                        onClick={(e) => {
                          e.stopPropagation()
                          copyToClipboard(note.content)
                        }}
                      >
                        <Copy className="w-3 h-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 hover:bg-muted"
                        onClick={(e) => {
                          e.stopPropagation()
                          downloadNote(note)
                        }}
                      >
                        <Download className="w-3 h-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 hover:bg-destructive/10 text-destructive"
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteNote(note.id)
                        }}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    <span>{formatDate(note.createdAt)}</span>
                    <span>•</span>
                    <span>{formatTime(note.duration)}</span>
                    {note.isGrammarCorrected && (
                      <>
                        <span>•</span>
                        <Badge variant="outline" className="text-xs px-1.5 py-0">
                          <Sparkles className="w-2.5 h-2.5 mr-1" />
                          AI
                        </Badge>
                      </>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                    {note.content.slice(0, 120)}...
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-sm border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center">
                <Mic className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h1 className="font-semibold text-foreground">AI Voice Notes</h1>
                <p className="text-xs text-muted-foreground hidden sm:block">
                  Transform speech into perfect text
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              {/* Grammar correction toggle */}
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-muted/50 rounded-lg">
                <Sparkles className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">AI Enhancement</span>
                <Switch
                  checked={grammarCorrection}
                  onCheckedChange={setGrammarCorrection}
                />
              </div>
              
              {/* Mobile notes toggle */}
              <Sheet open={isSidebarOpen} onOpenChange={setIsSidebarOpen}>
                <SheetTrigger asChild>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="lg:hidden mobile-touch-target"
                  >
                    <Menu className="w-4 h-4" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-80 p-0">
                  <NotesPanel />
                </SheetContent>
              </Sheet>
              
              <Button
                variant="outline"
                size="sm"
                onClick={() => blink.auth.logout()}
                className="mobile-touch-target"
              >
                Sign Out
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Recording Panel */}
          <div className="lg:col-span-2 space-y-6">
            {/* Mobile grammar toggle */}
            <Card className="sm:hidden shadow-soft">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium">AI Enhancement</span>
                  </div>
                  <Switch
                    checked={grammarCorrection}
                    onCheckedChange={setGrammarCorrection}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Recording Controls */}
            <Card className="shadow-medium">
              <CardContent className="p-6 sm:p-8">
                <div className="text-center space-y-6">
                  {/* Recording Button */}
                  <div className="relative">
                    <Button
                      size="lg"
                      className={`w-24 h-24 sm:w-32 sm:h-32 rounded-full text-white font-semibold transition-all duration-200 mobile-touch-target ${
                        isRecording 
                          ? 'bg-destructive hover:bg-destructive/90 recording-pulse' 
                          : 'bg-primary hover:bg-primary/90 hover:scale-105'
                      } ${isTranscribing ? 'cursor-not-allowed opacity-50' : ''}`}
                      onClick={isRecording ? stopRecording : startRecording}
                      disabled={isTranscribing}
                    >
                      {isTranscribing ? (
                        <div className="flex flex-col items-center gap-2">
                          <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                          <span className="text-xs">Processing...</span>
                        </div>
                      ) : isRecording ? (
                        <div className="flex flex-col items-center gap-2">
                          <Square className="w-6 h-6 sm:w-8 sm:h-8" />
                          <span className="text-xs">Stop</span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-2">
                          <Mic className="w-6 h-6 sm:w-8 sm:h-8" />
                          <span className="text-xs">Record</span>
                        </div>
                      )}
                    </Button>
                  </div>

                  {/* Audio Visualizer */}
                  <div className="flex justify-center min-h-[40px] items-center">
                    <AudioVisualizer isRecording={isRecording && !isPaused} />
                  </div>

                  {/* Recording Controls */}
                  {isRecording && (
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={pauseRecording}
                        className="flex items-center gap-2 mobile-touch-target"
                      >
                        {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                        <span>{isPaused ? 'Resume' : 'Pause'}</span>
                      </Button>
                      <div className="flex items-center gap-2 px-3 py-2 bg-muted rounded-lg">
                        <Clock className="w-4 h-4 text-muted-foreground" />
                        <span className="font-mono text-sm font-medium">{formatTime(recordingTime)}</span>
                      </div>
                    </div>
                  )}

                  {/* Status */}
                  <div className="flex flex-wrap justify-center gap-2">
                    {isRecording ? (
                      <Badge variant="secondary" className="animate-pulse bg-destructive/10 text-destructive border-destructive/20">
                        <Volume2 className="w-3 h-3 mr-1" />
                        {isPaused ? 'Paused' : 'Recording...'}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-muted/50">
                        <MicOff className="w-3 h-3 mr-1" />
                        Ready to record
                      </Badge>
                    )}
                    {grammarCorrection && (
                      <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20">
                        <Sparkles className="w-3 h-3 mr-1" />
                        AI Enhancement ON
                      </Badge>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Current Transcript */}
            {currentTranscript && (
              <Card className="shadow-medium animate-slide-up">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <FileText className="w-5 h-5" />
                    <span>Latest Transcript</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="p-4 bg-muted/30 rounded-lg border">
                    <p className="text-sm leading-relaxed text-foreground">{currentTranscript}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyToClipboard(currentTranscript)}
                      className="flex items-center gap-2"
                    >
                      <Copy className="w-4 h-4" />
                      <span>Copy</span>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Selected Note Detail - Mobile */}
            {selectedNote && (
              <Card className="lg:hidden shadow-medium animate-slide-up">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Note Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="font-medium text-muted-foreground">Created:</span>
                        <p className="text-foreground">{formatDate(selectedNote.createdAt)}</p>
                      </div>
                      <div>
                        <span className="font-medium text-muted-foreground">Duration:</span>
                        <p className="text-foreground">{formatTime(selectedNote.duration)}</p>
                      </div>
                    </div>
                    {selectedNote.isGrammarCorrected && (
                      <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20">
                        <Sparkles className="w-3 h-3 mr-1" />
                        AI Enhanced
                      </Badge>
                    )}
                  </div>
                  <Separator />
                  <div className="space-y-3">
                    <div className="p-3 bg-muted/30 rounded-lg border">
                      <h5 className="font-medium text-sm mb-2">Content:</h5>
                      <p className="text-sm leading-relaxed">{selectedNote.content}</p>
                    </div>
                    {selectedNote.isGrammarCorrected && selectedNote.originalTranscript !== selectedNote.content && (
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                        <h5 className="font-medium text-sm mb-2 text-amber-800">Original:</h5>
                        <p className="text-sm leading-relaxed text-amber-700">{selectedNote.originalTranscript}</p>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyToClipboard(selectedNote.content)}
                      className="flex-1"
                    >
                      <Copy className="w-4 h-4 mr-2" />
                      Copy
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => downloadNote(selectedNote)}
                      className="flex-1"
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Download
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Desktop Notes Sidebar */}
          <div className="hidden lg:block space-y-6">
            <Card className="shadow-medium">
              <NotesPanel />
            </Card>

            {/* Selected Note Detail - Desktop */}
            {selectedNote && (
              <Card className="shadow-medium animate-slide-up">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Note Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-3">
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="font-medium text-muted-foreground">Created:</span>
                        <span className="text-foreground">{formatDate(selectedNote.createdAt)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="font-medium text-muted-foreground">Duration:</span>
                        <span className="text-foreground">{formatTime(selectedNote.duration)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="font-medium text-muted-foreground">AI Enhanced:</span>
                        <Badge variant={selectedNote.isGrammarCorrected ? "default" : "outline"} className="text-xs">
                          {selectedNote.isGrammarCorrected ? "Yes" : "No"}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <Separator />
                  <div className="space-y-3">
                    <div className="p-3 bg-muted/30 rounded-lg border">
                      <h5 className="font-medium text-sm mb-2">Content:</h5>
                      <p className="text-sm leading-relaxed">{selectedNote.content}</p>
                    </div>
                    {selectedNote.isGrammarCorrected && selectedNote.originalTranscript !== selectedNote.content && (
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                        <h5 className="font-medium text-sm mb-2 text-amber-800">Original:</h5>
                        <p className="text-sm leading-relaxed text-amber-700">{selectedNote.originalTranscript}</p>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyToClipboard(selectedNote.content)}
                      className="flex-1"
                    >
                      <Copy className="w-4 h-4 mr-1" />
                      Copy
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => downloadNote(selectedNote)}
                      className="flex-1"
                    >
                      <Download className="w-4 h-4 mr-1" />
                      Download
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
      <Toaster />
    </div>
  )
}

export default App