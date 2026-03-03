'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useMissionControl } from '@/store'
import { useSmartPoll } from '@/lib/use-smart-poll'

interface Task {
  id: number
  title: string
  description?: string
  status: 'inbox' | 'assigned' | 'in_progress' | 'review' | 'quality_review' | 'done'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  assigned_to?: string
  created_by: string
  created_at: number
  updated_at: number
  due_date?: number
  estimated_hours?: number
  actual_hours?: number
  tags?: string[]
  metadata?: any
  aegisApproved?: boolean
}

interface Agent {
  id: number
  name: string
  role: string
  status: 'offline' | 'idle' | 'busy' | 'error'
  taskStats?: {
    total: number
    assigned: number
    in_progress: number
    completed: number
  }
}

interface Comment {
  id: number
  task_id: number
  author: string
  content: string
  created_at: number
  parent_id?: number
  mentions?: string[]
  replies?: Comment[]
}

const statusColumns = [
  { key: 'inbox', title: 'Backlog', color: 'bg-secondary text-foreground' },
  { key: 'assigned', title: 'Assigned', color: 'bg-blue-500/20 text-blue-400' },
  { key: 'in_progress', title: 'In Progress', color: 'bg-yellow-500/20 text-yellow-400' },
  { key: 'review', title: 'Review', color: 'bg-purple-500/20 text-purple-400' },
  { key: 'quality_review', title: 'Quality Review', color: 'bg-indigo-500/20 text-indigo-400' },
  { key: 'done', title: 'Done', color: 'bg-green-500/20 text-green-400' },
]

const priorityColors = {
  low:      'border-green-500',
  medium:   'border-yellow-500',
  high:     'border-orange-500',
  urgent:   'border-red-500',
  critical: 'border-red-600',
}

const priorityBadge: Record<string, string> = {
  low:      'bg-green-500/15 text-green-400 border border-green-500/30',
  medium:   'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30',
  high:     'bg-orange-500/15 text-orange-400 border border-orange-500/30',
  urgent:   'bg-red-500/15 text-red-400 border border-red-500/30',
  critical: 'bg-red-600/15 text-red-400 border border-red-600/30',
}

const ownerBadge: Record<string, string> = {
  CJ:       'bg-blue-500/15 text-blue-400',
  Codex:    'bg-purple-500/15 text-purple-400',
  Ralphael: 'bg-amber-500/15 text-amber-400',
}

// Simple description formatter — renders **bold** markers and newlines
function formatDescription(text: string): React.ReactNode {
  if (!text) return null
  return text.split('\n').map((line, i) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/)
    return (
      <span key={i}>
        {parts.map((part, j) =>
          part.startsWith('**') && part.endsWith('**')
            ? <strong key={j} className="text-foreground/90">{part.slice(2, -2)}</strong>
            : <span key={j}>{part}</span>
        )}
        {i < text.split('\n').length - 1 && <br />}
      </span>
    )
  })
}

// Extract structured fields embedded in description by the migration script
function parseDescription(raw?: string): { body: string; successMetric?: string; dependency?: string; notes?: string } {
  if (!raw) return { body: '' }
  const sm  = raw.match(/\*\*Success metric:\*\*\s*([^\n*]+)/)
  const dep = raw.match(/\*\*Dependency:\*\*\s*([^\n*]+)/)
  const nt  = raw.match(/\*\*Notes:\*\*\s*([\s\S]+?)(?:\*\*|$)/)
  const body = raw
    .replace(/\n?\n?\*\*Success metric:\*\*[\s\S]*/, '')
    .replace(/\n?\n?\*\*Dependency:\*\*[\s\S]*/, '')
    .replace(/\n?\n?\*\*Notes:\*\*[\s\S]*/, '')
    .trim()
  return {
    body,
    successMetric: sm?.[1]?.trim(),
    dependency:    dep?.[1]?.trim(),
    notes:         nt?.[1]?.trim(),
  }
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function isOverdue(ts: number): boolean {
  return ts * 1000 < Date.now()
}

function getTagColor(tag: string): string {
  const t = tag.toLowerCase()
  if (t.includes('urgent') || t.includes('critical') || t === 'sec') return 'bg-red-500/20 text-red-400 border-red-500/30'
  if (t.includes('bug') || t.includes('fix')) return 'bg-orange-500/20 text-orange-400 border-orange-500/30'
  if (t.includes('feature') || t.includes('enhancement') || t === 'feat') return 'bg-green-500/20 text-green-400 border-green-500/30'
  if (t.includes('research') || t.includes('analysis') || t === 'ops') return 'bg-purple-500/20 text-purple-400 border-purple-500/30'
  if (t.includes('deploy') || t.includes('release') || t === 'infra') return 'bg-blue-500/20 text-blue-400 border-blue-500/30'
  if (t === 'auto') return 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30'
  if (t === 'crm') return 'bg-pink-500/20 text-pink-400 border-pink-500/30'
  if (t === 'billing') return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
  return 'bg-muted-foreground/10 text-muted-foreground border-muted-foreground/20'
}

export function TaskBoardPanel() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [draggedTask, setDraggedTask] = useState<Task | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const dragCounter = useRef(0)

  // Fetch tasks and agents
  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const [tasksResponse, agentsResponse] = await Promise.all([
        fetch('/api/tasks'),
        fetch('/api/agents')
      ])

      if (!tasksResponse.ok || !agentsResponse.ok) {
        throw new Error('Failed to fetch data')
      }

      const tasksData = await tasksResponse.json()
      const agentsData = await agentsResponse.json()

      const tasksList = tasksData.tasks || []
      const taskIds = tasksList.map((task: Task) => task.id)

      let aegisMap: Record<number, boolean> = {}
      if (taskIds.length > 0) {
        try {
          const reviewResponse = await fetch(`/api/quality-review?taskIds=${taskIds.join(',')}`)
          if (reviewResponse.ok) {
            const reviewData = await reviewResponse.json()
            const latest = reviewData.latest || {}
            aegisMap = Object.fromEntries(
              Object.entries(latest).map(([id, row]: [string, any]) => [
                Number(id),
                row?.reviewer === 'aegis' && row?.status === 'approved'
              ])
            )
          }
        } catch (error) {
          aegisMap = {}
        }
      }

      setTasks(
        tasksList.map((task: Task) => ({
          ...task,
          aegisApproved: Boolean(aegisMap[task.id])
        }))
      )
      setAgents(agentsData.agents || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Group tasks by status
  const tasksByStatus = statusColumns.reduce((acc, column) => {
    acc[column.key] = tasks.filter(task => task.status === column.key)
    return acc
  }, {} as Record<string, Task[]>)

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, task: Task) => {
    setDraggedTask(task)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/html', e.currentTarget.outerHTML)
  }

  const handleDragEnter = (e: React.DragEvent, status: string) => {
    e.preventDefault()
    dragCounter.current++
    e.currentTarget.classList.add('drag-over')
  }

  const handleDragLeave = (e: React.DragEvent) => {
    dragCounter.current--
    if (dragCounter.current === 0) {
      e.currentTarget.classList.remove('drag-over')
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDrop = async (e: React.DragEvent, newStatus: string) => {
    e.preventDefault()
    dragCounter.current = 0
    e.currentTarget.classList.remove('drag-over')

    if (!draggedTask || draggedTask.status === newStatus) {
      setDraggedTask(null)
      return
    }

    try {
      if (newStatus === 'done') {
        const reviewResponse = await fetch(`/api/quality-review?taskId=${draggedTask.id}`)
        if (!reviewResponse.ok) {
          throw new Error('Unable to verify Aegis approval')
        }
        const reviewData = await reviewResponse.json()
        const latest = reviewData.reviews?.find((review: any) => review.reviewer === 'aegis')
        if (!latest || latest.status !== 'approved') {
          throw new Error('Aegis approval is required before moving to done')
        }
      }

      // Optimistically update UI
      setTasks(prevTasks =>
        prevTasks.map(task =>
          task.id === draggedTask.id
            ? { ...task, status: newStatus as Task['status'], updated_at: Math.floor(Date.now() / 1000) }
            : task
        )
      )

      // Update on server
      const response = await fetch('/api/tasks', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tasks: [{ id: draggedTask.id, status: newStatus }]
        })
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to update task status')
      }
    } catch (err) {
      // Revert optimistic update
      setTasks(prevTasks =>
        prevTasks.map(task =>
          task.id === draggedTask.id
            ? { ...task, status: draggedTask.status }
            : task
        )
      )
      setError(err instanceof Error ? err.message : 'Failed to update task status')
    } finally {
      setDraggedTask(null)
    }
  }

  // Format relative time for tasks
  const formatTaskTimestamp = (timestamp: number) => {
    const now = new Date().getTime()
    const time = new Date(timestamp * 1000).getTime()
    const diff = now - time
    
    const seconds = Math.floor(diff / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)
    
    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
    return 'just now'
  }

  // Get agent name by session key
  const getAgentName = (sessionKey?: string) => {
    const agent = agents.find(a => a.name === sessionKey)
    return agent?.name || sessionKey || 'Unassigned'
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        <span className="ml-2 text-muted-foreground">Loading tasks...</span>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex justify-between items-center p-4 border-b border-border flex-shrink-0">
        <h2 className="text-xl font-bold text-foreground">Task Board</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-smooth text-sm font-medium"
          >
            + New Task
          </button>
          <button
            onClick={fetchData}
            className="px-4 py-2 bg-secondary text-muted-foreground rounded-md hover:bg-surface-2 transition-smooth text-sm font-medium"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 m-4 rounded-lg text-sm flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-red-400/60 hover:text-red-400 ml-2"
          >
            ×
          </button>
        </div>
      )}

      {/* Kanban Board */}
      <div className="flex-1 flex gap-4 p-4 overflow-x-auto">
        {statusColumns.map(column => (
          <div
            key={column.key}
            className="flex-1 min-w-80 bg-card border border-border rounded-lg flex flex-col"
            onDragEnter={(e) => handleDragEnter(e, column.key)}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, column.key)}
          >
            {/* Column Header */}
            <div className={`${column.color} p-3 rounded-t-lg flex justify-between items-center`}>
              <h3 className="font-semibold">{column.title}</h3>
              <span className="text-sm bg-black/20 px-2 py-1 rounded">
                {tasksByStatus[column.key]?.length || 0}
              </span>
            </div>

            {/* Column Body */}
            <div className="flex-1 p-3 space-y-3 min-h-32">
              {tasksByStatus[column.key]?.map(task => {
                const { body } = parseDescription(task.description)
                const owner = task.assigned_to
                return (
                <div
                  key={task.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, task)}
                  onClick={() => setSelectedTask(task)}
                  className={`bg-surface-1 rounded-lg p-3 cursor-pointer hover:bg-surface-2 transition-smooth border-l-4 ${priorityColors[task.priority] ?? 'border-border'} ${
                    draggedTask?.id === task.id ? 'opacity-40' : ''
                  } group`}
                >
                  {/* Title row */}
                  <div className="flex justify-between items-start gap-2 mb-2">
                    <h4 className="text-foreground font-semibold text-sm leading-snug flex-1">
                      {task.title}
                    </h4>
                    <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide ${priorityBadge[task.priority] ?? priorityBadge.medium}`}>
                      {task.priority}
                    </span>
                  </div>

                  {/* Description preview — strip embedded markers */}
                  {body && (
                    <p className="text-muted-foreground text-xs mb-2 line-clamp-2 leading-relaxed">
                      {body}
                    </p>
                  )}

                  {/* Tags */}
                  {task.tags && task.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {task.tags.slice(0, 3).map((tag, i) => (
                        <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${getTagColor(tag)}`}>
                          {tag}
                        </span>
                      ))}
                      {task.tags.length > 3 && (
                        <span className="text-[10px] text-muted-foreground/60 self-center">+{task.tags.length - 3}</span>
                      )}
                    </div>
                  )}

                  {/* Footer: owner + due date */}
                  <div className="flex items-center justify-between mt-1 gap-2">
                    <div className="flex items-center gap-1.5">
                      {owner && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${ownerBadge[owner] ?? 'bg-secondary text-muted-foreground'}`}>
                          {owner}
                        </span>
                      )}
                      {task.aegisApproved && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-700/40 text-emerald-300 font-medium">✓ Aegis</span>
                      )}
                    </div>
                    {task.due_date ? (
                      <span className={`text-[10px] font-medium ${isOverdue(task.due_date) ? 'text-red-400' : 'text-muted-foreground/70'}`}>
                        {isOverdue(task.due_date) ? '⚠ ' : ''}Due {formatDate(task.due_date)}
                      </span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground/40">{formatTaskTimestamp(task.updated_at ?? task.created_at)}</span>
                    )}
                  </div>
                </div>
                )
              })}

              {/* Empty State */}
              {tasksByStatus[column.key]?.length === 0 && (
                <div className="text-center text-muted-foreground/50 py-8 text-sm">
                  No tasks in {column.title.toLowerCase()}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Task Detail Modal */}
      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          agents={agents}
          onClose={() => setSelectedTask(null)}
          onUpdate={fetchData}
        />
      )}

      {/* Create Task Modal */}
      {showCreateModal && (
        <CreateTaskModal
          agents={agents}
          onClose={() => setShowCreateModal(false)}
          onCreated={fetchData}
        />
      )}
    </div>
  )
}

// Task Detail Modal — structured layout matching JAIS Command Ops style
function TaskDetailModal({ 
  task, 
  agents, 
  onClose, 
  onUpdate 
}: { 
  task: Task
  agents: Agent[]
  onClose: () => void
  onUpdate: () => void
}) {
  const [comments, setComments] = useState<Comment[]>([])
  const [loadingComments, setLoadingComments] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [commentAuthor, setCommentAuthor] = useState('CJ')
  const [commentError, setCommentError] = useState<string | null>(null)
  const [broadcastMessage, setBroadcastMessage] = useState('')
  const [broadcastStatus, setBroadcastStatus] = useState<string | null>(null)
  const [reviews, setReviews] = useState<any[]>([])
  const [reviewStatus, setReviewStatus] = useState<'approved' | 'rejected'>('approved')
  const [reviewNotes, setReviewNotes] = useState('')
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'details' | 'comments' | 'quality'>('details')
  const [reviewer, setReviewer] = useState('aegis')

  const { body, successMetric, dependency, notes } = parseDescription(task.description)

  const fetchReviews = useCallback(async () => {
    try {
      const response = await fetch(`/api/quality-review?taskId=${task.id}`)
      if (!response.ok) throw new Error('Failed to fetch reviews')
      const data = await response.json()
      setReviews(data.reviews || [])
    } catch (error) {
      setReviewError('Failed to load quality reviews')
    }
  }, [task.id])

  const fetchComments = useCallback(async () => {
    try {
      setLoadingComments(true)
      const response = await fetch(`/api/tasks/${task.id}/comments`)
      if (!response.ok) throw new Error('Failed to fetch comments')
      const data = await response.json()
      setComments(data.comments || [])
    } catch (error) {
      setCommentError('Failed to load comments')
    } finally {
      setLoadingComments(false)
    }
  }, [task.id])

  useEffect(() => {
    fetchComments()
  }, [fetchComments])
  useEffect(() => {
    fetchReviews()
  }, [fetchReviews])
  
  useSmartPoll(fetchComments, 15000)

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!commentText.trim()) return

    try {
      setCommentError(null)
      const response = await fetch(`/api/tasks/${task.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          author: commentAuthor || 'system',
          content: commentText
        })
      })
      if (!response.ok) throw new Error('Failed to add comment')
      setCommentText('')
      await fetchComments()
      onUpdate()
    } catch (error) {
      setCommentError('Failed to add comment')
    }
  }

  const handleBroadcast = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!broadcastMessage.trim()) return

    try {
      setBroadcastStatus(null)
      const response = await fetch(`/api/tasks/${task.id}/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          author: commentAuthor || 'system',
          message: broadcastMessage
        })
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Broadcast failed')
      setBroadcastMessage('')
      setBroadcastStatus(`Sent to ${data.sent || 0} subscribers`)
    } catch (error) {
      setBroadcastStatus('Failed to broadcast')
    }
  }

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      setReviewError(null)
      const response = await fetch('/api/quality-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: task.id,
          reviewer,
          status: reviewStatus,
          notes: reviewNotes
        })
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to submit review')
      setReviewNotes('')
      await fetchReviews()
      onUpdate()
    } catch (error) {
      setReviewError('Failed to submit review')
    }
  }

  const renderComment = (comment: Comment, depth: number = 0) => (
    <div key={comment.id} className={`border-l-2 border-border pl-3 ${depth > 0 ? 'ml-4' : ''}`}>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-medium text-foreground/80">{comment.author}</span>
        <span>{new Date(comment.created_at * 1000).toLocaleString()}</span>
      </div>
      <div className="text-sm text-foreground/90 mt-1 whitespace-pre-wrap">{comment.content}</div>
      {comment.replies && comment.replies.length > 0 && (
        <div className="mt-3 space-y-3">
          {comment.replies.map(reply => renderComment(reply, depth + 1))}
        </div>
      )}
    </div>
  )

  const statusLabel: Record<string, string> = {
    inbox: 'Backlog', assigned: 'Assigned', in_progress: 'In Progress',
    review: 'Review', quality_review: 'Quality Review', done: 'Done',
  }
  const statusBadgeColor: Record<string, string> = {
    inbox:          'bg-secondary text-muted-foreground',
    assigned:       'bg-blue-500/20 text-blue-400',
    in_progress:    'bg-yellow-500/20 text-yellow-400',
    review:         'bg-purple-500/20 text-purple-400',
    quality_review: 'bg-indigo-500/20 text-indigo-400',
    done:           'bg-green-500/20 text-green-400',
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-xl max-w-2xl w-full max-h-[92vh] overflow-y-auto shadow-2xl">

        {/* ── Modal Header ─────────────────────────────── */}
        <div className="p-5 border-b border-border">
          <div className="flex justify-between items-start gap-3 mb-3">
            <h3 className="text-lg font-bold text-foreground leading-snug flex-1">{task.title}</h3>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl shrink-0 leading-none transition-smooth">×</button>
          </div>

          {/* Status + Priority badges */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${statusBadgeColor[task.status] ?? 'bg-secondary text-muted-foreground'}`}>
              {statusLabel[task.status] ?? task.status}
            </span>
            <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${priorityBadge[task.priority] ?? priorityBadge.medium}`}>
              {task.priority?.toUpperCase()}
            </span>
            {task.aegisApproved && (
              <span className="text-xs px-2.5 py-1 rounded-full font-semibold bg-emerald-700/40 text-emerald-300 border border-emerald-500/30">✓ Aegis Approved</span>
            )}
          </div>

          {/* Metadata row */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1.5 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground/60 uppercase tracking-wide font-semibold text-[10px]">Owner</span>
              {task.assigned_to
                ? <span className={`px-2 py-0.5 rounded font-medium ${ownerBadge[task.assigned_to] ?? 'bg-secondary text-muted-foreground'}`}>{task.assigned_to}</span>
                : <span className="text-muted-foreground italic">Unassigned</span>
              }
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground/60 uppercase tracking-wide font-semibold text-[10px]">Due</span>
              {task.due_date
                ? <span className={`font-medium ${isOverdue(task.due_date) ? 'text-red-400' : 'text-foreground/80'}`}>
                    {isOverdue(task.due_date) ? '⚠ ' : ''}{formatDate(task.due_date)}
                  </span>
                : <span className="text-muted-foreground italic">No date</span>
              }
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground/60 uppercase tracking-wide font-semibold text-[10px]">Created</span>
              <span className="text-foreground/80">{formatDate(task.created_at)}</span>
            </div>
          </div>

          {/* Tags */}
          {task.tags && task.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {task.tags.map((tag, i) => (
                <span key={i} className={`text-[10px] px-2 py-0.5 rounded border font-medium ${getTagColor(tag)}`}>{tag}</span>
              ))}
            </div>
          )}
        </div>

        {/* ── Tabs ─────────────────────────────────────── */}
        <div className="flex gap-1 px-5 pt-3 border-b border-border">
          {(['details', 'comments', 'quality'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-2 text-sm rounded-t transition-smooth font-medium ${
                activeTab === tab
                  ? 'bg-primary/10 text-primary border-b-2 border-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab === 'details' ? 'Details' : tab === 'comments' ? `Comments` : 'Quality Review'}
            </button>
          ))}
        </div>

        <div className="p-5">

          {/* ── Details Tab ──────────────────────────────── */}
          {activeTab === 'details' && (
            <div className="space-y-5">

              {/* Description */}
              {body && (
                <div>
                  <h4 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-1.5">Description</h4>
                  <div className="text-sm text-foreground/85 leading-relaxed bg-surface-1/50 rounded-lg p-3 border border-border/50 whitespace-pre-wrap">
                    {formatDescription(body)}
                  </div>
                </div>
              )}

              {/* Success Metric */}
              {successMetric && (
                <div>
                  <h4 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-1.5">Success Metric</h4>
                  <div className="text-sm text-foreground/85 bg-green-500/5 border border-green-500/20 rounded-lg p-3">
                    {successMetric}
                  </div>
                </div>
              )}

              {/* Dependency */}
              {dependency && dependency.toLowerCase() !== 'none' && (
                <div>
                  <h4 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-1.5">Dependency</h4>
                  <div className="text-sm text-foreground/85 bg-yellow-500/5 border border-yellow-500/20 rounded-lg p-3">
                    {dependency}
                  </div>
                </div>
              )}

              {/* Notes */}
              {notes && (
                <div>
                  <h4 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-1.5">Notes</h4>
                  <div className="space-y-1.5">
                    {notes.split(' | ').map((note, i) => (
                      <div key={i} className="text-sm text-foreground/85 bg-surface-1/50 rounded-lg p-2.5 border border-border/50 flex gap-2">
                        <span className="text-primary/60 shrink-0">▸</span>
                        <span>{note.trim()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* If description has no structured parts and no separate fields, show raw */}
              {!body && !successMetric && !dependency && !notes && (
                <div className="text-sm text-muted-foreground italic">No description provided.</div>
              )}

            </div>
          )}

          {activeTab === 'comments' && (
            <div className="mt-6">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-lg font-semibold text-foreground">Comments</h4>
              <button
                onClick={fetchComments}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                Refresh
              </button>
            </div>

            {commentError && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-2 rounded-md text-sm mb-3">
                {commentError}
              </div>
            )}

            {loadingComments ? (
              <div className="text-muted-foreground text-sm">Loading comments...</div>
            ) : comments.length === 0 ? (
              <div className="text-muted-foreground/50 text-sm">No comments yet.</div>
            ) : (
              <div className="space-y-4">
                {comments.map(comment => renderComment(comment))}
              </div>
            )}

            <form onSubmit={handleAddComment} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Author</label>
                <input
                  type="text"
                  value={commentAuthor}
                  onChange={(e) => setCommentAuthor(e.target.value)}
                  className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">New Comment</label>
                <textarea
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  rows={3}
                />
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-smooth text-sm"
                >
                  Add Comment
                </button>
              </div>
            </form>

            <div className="mt-6 border-t border-border pt-4">
              <h5 className="text-sm font-medium text-foreground mb-2">Broadcast to Subscribers</h5>
              {broadcastStatus && (
                <div className="text-xs text-muted-foreground mb-2">{broadcastStatus}</div>
              )}
              <form onSubmit={handleBroadcast} className="space-y-2">
                <textarea
                  value={broadcastMessage}
                  onChange={(e) => setBroadcastMessage(e.target.value)}
                  className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  rows={2}
                  placeholder="Send a message to all task subscribers..."
                />
                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="px-3 py-2 bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded-md hover:bg-purple-500/30 transition-smooth text-xs"
                  >
                    Broadcast
                  </button>
                </div>
              </form>
            </div>
          </div>
          )}

          {/* ── Quality Tab ──────────────────────────────── */}
          {activeTab === 'quality' && (
            <div className="mt-6">
              <h5 className="text-sm font-medium text-foreground mb-2">Aegis Quality Review</h5>
              {reviewError && (
                <div className="text-xs text-red-400 mb-2">{reviewError}</div>
              )}
              {reviews.length > 0 ? (
                <div className="space-y-2 mb-3">
                  {reviews.map((review) => (
                    <div key={review.id} className="text-xs text-foreground/80 bg-surface-1/40 rounded p-2">
                      <div className="flex justify-between">
                        <span>{review.reviewer} — {review.status}</span>
                        <span>{new Date(review.created_at * 1000).toLocaleString()}</span>
                      </div>
                      {review.notes && <div className="mt-1">{review.notes}</div>}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground mb-3">No reviews yet.</div>
              )}
              <form onSubmit={handleSubmitReview} className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={reviewer}
                    onChange={(e) => setReviewer(e.target.value)}
                    className="bg-surface-1 text-foreground border border-border rounded-md px-2 py-1 text-xs"
                    placeholder="Reviewer (e.g., aegis)"
                  />
                  <select
                    value={reviewStatus}
                    onChange={(e) => setReviewStatus(e.target.value as 'approved' | 'rejected')}
                    className="bg-surface-1 text-foreground border border-border rounded-md px-2 py-1 text-xs"
                  >
                    <option value="approved">approved</option>
                    <option value="rejected">rejected</option>
                  </select>
                  <input
                    type="text"
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    className="flex-1 bg-surface-1 text-foreground border border-border rounded-md px-2 py-1 text-xs"
                    placeholder="Review notes (required)"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1 bg-green-500/20 text-green-400 border border-green-500/30 rounded-md text-xs"
                  >
                    Submit
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Create Task Modal Component (placeholder)
function CreateTaskModal({ 
  agents, 
  onClose, 
  onCreated 
}: { 
  agents: Agent[]
  onClose: () => void
  onCreated: () => void
}) {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    priority: 'medium' as Task['priority'],
    assigned_to: '',
    tags: '',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          tags: formData.tags ? formData.tags.split(',').map(t => t.trim()) : [],
          assigned_to: formData.assigned_to || undefined
        })
      })

      if (!response.ok) throw new Error('Failed to create task')
      
      onCreated()
      onClose()
    } catch (error) {
      console.error('Error creating task:', error)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-lg max-w-md w-full">
        <form onSubmit={handleSubmit} className="p-6">
          <h3 className="text-xl font-bold text-foreground mb-4">Create New Task</h3>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Title</label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                rows={3}
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-muted-foreground mb-1">Priority</label>
                <select
                  value={formData.priority}
                  onChange={(e) => setFormData(prev => ({ ...prev, priority: e.target.value as Task['priority'] }))}
                  className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm text-muted-foreground mb-1">Assign to</label>
                <select
                  value={formData.assigned_to}
                  onChange={(e) => setFormData(prev => ({ ...prev, assigned_to: e.target.value }))}
                  className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                >
                  <option value="">Unassigned</option>
                  {agents.map(agent => (
                    <option key={agent.name} value={agent.name}>
                      {agent.name} ({agent.role})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Tags (comma-separated)</label>
              <input
                type="text"
                value={formData.tags}
                onChange={(e) => setFormData(prev => ({ ...prev, tags: e.target.value }))}
                className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
                placeholder="frontend, urgent, bug"
              />
            </div>
          </div>
          
          <div className="flex gap-3 mt-6">
            <button
              type="submit"
              className="flex-1 bg-primary text-primary-foreground py-2 rounded-md hover:bg-primary/90 transition-smooth"
            >
              Create Task
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-secondary text-muted-foreground py-2 rounded-md hover:bg-surface-2 transition-smooth"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
