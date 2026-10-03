import { MessageSquarePlus, SendHorizonal, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';

import { EmptyState } from '../components/EmptyState';
import { LoadingState } from '../components/LoadingState';
import { ApiError, conversationApi, type Conversation, type ConversationDetail, type ConversationMessage, type GeneratedRepositoryTests, type RepositoryAnalysis } from '../lib/api';

export function ChatPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedConversationId = searchParams.get('conversationId');
  const requestedRepositoryId = searchParams.get('repositoryId');
  const initialRoute = useRef({ conversationId: requestedConversationId, repositoryId: requestedRepositoryId });
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [sourcesByAssistant, setSourcesByAssistant] = useState<Record<string, string[]>>({});
  const [draft, setDraft] = useState('');
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<RepositoryAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [generatedTests, setGeneratedTests] = useState<GeneratedRepositoryTests | null>(null);
  const [generatingTests, setGeneratingTests] = useState(false);
  const [testGenerationError, setTestGenerationError] = useState<string | null>(null);
  const [analysisType, setAnalysisType] = useState<'explain' | 'bugs' | 'smells' | 'security' | 'function' | 'interactions' | 'improvements'>('explain');
  const [loadingList, setLoadingList] = useState(true);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openConversation = async (conversationId: string) => {
    setLoadingConversation(true);
    setError(null);
    setPendingText(null);
    try {
      const result = await conversationApi.get(conversationId);
      setDetail(result);
      setSearchParams({ conversationId }, { replace: true });
    } catch (requestError) {
      setDetail(null);
      setError(requestError instanceof ApiError ? requestError.message : 'Unable to open this conversation.');
    } finally {
      setLoadingConversation(false);
    }
  };

  const createConversation = async (repositoryId?: string | null) => {
    setCreating(true);
    setError(null);
    try {
      const result = await conversationApi.create(repositoryId ? { repositoryId } : {});
      setConversations((current) => [result.conversation, ...current]);
      await openConversation(result.conversation.id);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'Unable to start a conversation.');
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    let active = true;
    const initialize = async () => {
      try {
        const result = await conversationApi.list();
        if (!active) return;
        setConversations(result.conversations);
        const route = initialRoute.current;
        let conversationId = route.conversationId;

        if (!conversationId && result.conversations.length > 0 && !route.repositoryId) {
          conversationId = result.conversations[0].id;
        }

        if (!conversationId) {
          const created = await conversationApi.create(route.repositoryId ? { repositoryId: route.repositoryId } : {});
          conversationId = created.conversation.id;
          if (active) setConversations((current) => [created.conversation, ...current]);
        }

        const loaded = await conversationApi.get(conversationId);
        if (active) {
          setDetail(loaded);
          if (!route.conversationId) setSearchParams({ conversationId }, { replace: true });
        }
      } catch (requestError) {
        if (active) setError(requestError instanceof ApiError ? requestError.message : 'Unable to load conversations.');
      } finally {
        if (active) setLoadingList(false);
      }
    };
    void initialize();
    return () => { active = false; };
  }, []);

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !detail || sending) return;

    const conversationId = detail.conversation.id;
    setDraft('');
    setSending(true);
    setError(null);
    setPendingText(content);

    try {
      const result = await conversationApi.sendMessage(conversationId, content);
      setDetail((current) => current ? {
        ...current,
        messages: [...current.messages, result.userMessage, result.assistantMessage],
        conversation: { ...current.conversation, updatedAt: result.assistantMessage.updatedAt },
      } : current);
      if (result.sources?.length) {
        setSourcesByAssistant((current) => ({ ...current, [result.assistantMessage.id]: result.sources ?? [] }));
      }
      try {
        const listResult = await conversationApi.list();
        setConversations(listResult.conversations);
      } catch {
        // The saved response remains visible even if the sidebar refresh fails.
      }
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'Unable to generate a response right now. Please try again.');
      try {
        const refreshed = await conversationApi.get(conversationId);
        setDetail(refreshed);
        const listResult = await conversationApi.list();
        setConversations(listResult.conversations);
      } catch {
        // Keep the current conversation visible if the refresh request also fails.
      }
    } finally {
      setPendingText(null);
      setSending(false);
    }
  };

  const promptIdeas = [
    'Explain what a REST API is in simple terms.',
    'What are a few practical ways to improve readability in a codebase?',
    'How should I approach writing tests for a new feature?',
  ];

  const analyzeRepository = async () => {
    const question = draft.trim();
    if (!question || !detail?.repository || analyzing || sending) return;
    setAnalyzing(true);
    setAnalysisError(null);
    setAnalysis(null);
    try {
      const result = await conversationApi.analyze(detail.conversation.id, question, analysisType);
      setAnalysis(result.analysis);
    } catch (requestError) {
      setAnalysisError(requestError instanceof ApiError ? requestError.message : 'Unable to analyze repository code right now.');
    } finally {
      setAnalyzing(false);
    }
  };

  const generateTests = async () => {
    const question = draft.trim();
    if (!question || !detail?.repository || generatingTests || sending) return;
    setGeneratingTests(true);
    setTestGenerationError(null);
    setGeneratedTests(null);
    try {
      const result = await conversationApi.generateTests(detail.conversation.id, question);
      setGeneratedTests(result.tests);
    } catch (requestError) {
      setTestGenerationError(requestError instanceof ApiError ? requestError.message : 'Unable to generate test suggestions right now.');
    } finally {
      setGeneratingTests(false);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(260px,0.75fr)]">
      <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-cyan-300">AI assistant</p>
            <h2 className="mt-2 max-w-lg truncate text-2xl font-semibold text-white">{detail?.conversation.title ?? 'General chat'}</h2>
          </div>
          {detail?.repository ? <span className="max-w-44 truncate rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-xs text-cyan-200" title={detail.repository.githubFullName}>{detail.repository.githubFullName}</span> : <span className="rounded-full border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-slate-400">General</span>}
        </div>

        <div className="max-h-[55vh] min-h-[280px] space-y-4 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-950/70 p-4" aria-live="polite">
          {loadingConversation || (loadingList && !detail) ? <LoadingState label="Loading conversation..." /> : detail ? detail.messages.filter((message: ConversationMessage) => message.role !== 'system').map((message: ConversationMessage) => (
            <div
              key={message.id}
              className={[
                'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl p-3 text-sm leading-6',
                message.role !== 'user'
                  ? 'bg-cyan-500/10 text-slate-100'
                  : 'ml-auto bg-slate-800 text-slate-100',
              ].join(' ')}
            >
              <p>{message.content}</p>
              {(sourcesByAssistant[message.id] ?? message.sources)?.length ? (
                <div className="mt-3 border-t border-slate-700/70 pt-2 text-xs text-slate-400">
                  <p className="mb-1 uppercase tracking-wider">Sources</p>
                  {(sourcesByAssistant[message.id] ?? message.sources ?? []).map((source) => <p key={source} className="truncate">{source}</p>)}
                </div>
              ) : null}
              <p className="mt-2 text-[10px] uppercase tracking-[0.2em] text-slate-400">{message.role === 'user' ? 'You' : 'DevPilot'} · {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
            </div>
          )) : null}
          {pendingText ? <>
            <div className="ml-auto max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-slate-800 p-3 text-sm leading-6 text-slate-100">{pendingText}<p className="mt-2 text-[10px] uppercase tracking-[0.2em] text-slate-400">You · sending</p></div>
            <div className="flex max-w-[85%] items-center gap-2 rounded-2xl bg-cyan-500/10 p-3 text-sm text-slate-300"><span className="flex gap-1" aria-label="DevPilot is thinking"><i className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300" /><i className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300 [animation-delay:120ms]" /><i className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300 [animation-delay:240ms]" /></span>DevPilot is thinking</div>
          </> : detail && detail.messages.length === 0 ? <EmptyState title="Start a conversation" description={detail.repository ? `Ask about ${detail.repository.githubFullName}. Relevant public files may be included as untrusted context.` : 'Ask a general development question. No repository files are included in this conversation.'} /> : null}
          {error ? <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}
        </div>

        {analysis ? (
          <section className="mt-4 space-y-3 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4" aria-label="Repository analysis">
            <h3 className="font-semibold text-cyan-100">Analysis · generated suggestions, not executed</h3>
            {analysis.factualFindings.map((finding, index) => <p key={`finding-${index}`} className="text-sm text-slate-200"><strong>Finding ({finding.confidence} confidence):</strong> {finding.statement}</p>)}
            {analysis.suggestions.map((suggestion, index) => <p key={`suggestion-${index}`} className="text-sm text-slate-200"><strong>Suggestion:</strong> {suggestion.statement}</p>)}
            {analysis.uncertainties.map((uncertainty, index) => <p key={`uncertainty-${index}`} className="text-sm text-amber-200"><strong>Uncertainty:</strong> {uncertainty}</p>)}
            <div className="border-t border-slate-700 pt-2 text-xs text-slate-400">Sources: {analysis.sources.join(', ')}</div>
          </section>
        ) : null}
        {analysisError ? <p role="alert" className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{analysisError}</p> : null}
        {generatedTests ? (
          <section className="mt-4 space-y-3 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4" aria-label="Generated test suggestions">
            <h3 className="font-semibold text-amber-100">{generatedTests.label} · {generatedTests.framework}</h3>
            <p className="text-sm text-slate-300">{generatedTests.fileName}</p>
            <pre className="max-h-96 overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-3 text-sm leading-6 text-slate-200"><code>{generatedTests.code}</code></pre>
            {generatedTests.notes.map((note, index) => <p key={`test-note-${index}`} className="text-sm text-slate-300">{note}</p>)}
            <div className="border-t border-slate-700 pt-2 text-xs text-slate-400">Sources: {generatedTests.sources.join(', ')}</div>
          </section>
        ) : null}
        {testGenerationError ? <p role="alert" className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{testGenerationError}</p> : null}

        <form onSubmit={sendMessage} className="mt-4 flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-3 sm:flex-row">
          <textarea
            aria-label="Chat message"
            rows={3}
            maxLength={20000}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={!detail || sending}
            className="min-h-[90px] flex-1 resize-none rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400"
            placeholder={detail?.repository ? 'Ask a question about this repository...' : 'Ask a general development question...'}
          />
          {detail?.repository ? <label className="sr-only" htmlFor="repository-analysis-type">Analysis type</label> : null}
          {detail?.repository ? <select
            id="repository-analysis-type"
            aria-label="Analysis type"
            value={analysisType}
            onChange={(event) => setAnalysisType(event.target.value as typeof analysisType)}
            disabled={sending || analyzing}
            className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          >
            <option value="explain">Explain</option>
            <option value="bugs">Possible bugs</option>
            <option value="smells">Code smells</option>
            <option value="security">Security review</option>
            <option value="function">Explain function</option>
            <option value="interactions">File interactions</option>
            <option value="improvements">Improvements</option>
          </select> : null}
          <button
            type="submit"
            disabled={!detail || !draft.trim() || sending}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-500 px-5 py-3 font-semibold text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <SendHorizonal className="h-4 w-4" />
            {sending ? 'Sending...' : 'Send'}
          </button>
          {detail?.repository ? <button
            type="button"
            disabled={!draft.trim() || sending || analyzing}
            onClick={() => void analyzeRepository()}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-500/30 px-4 py-3 font-semibold text-cyan-100 hover:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {analyzing ? 'Analyzing...' : 'Analyze code'}
          </button> : null}
          {detail?.repository ? <button
            type="button"
            disabled={!draft.trim() || sending || generatingTests}
            onClick={() => void generateTests()}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-500/30 px-4 py-3 font-semibold text-amber-100 hover:border-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generatingTests ? 'Generating...' : 'Generate tests'}
          </button> : null}
        </form>
      </div>

      <aside className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-[0.28em] text-cyan-300">Conversations</p>
          <button type="button" disabled={creating} onClick={() => void createConversation()} aria-label="New general conversation" title="New conversation" className="rounded-lg border border-slate-700 p-2 text-slate-200 hover:border-cyan-400/40 hover:text-white disabled:opacity-50"><MessageSquarePlus className="h-4 w-4" /></button>
        </div>
        {loadingList ? <LoadingState label="Loading conversations..." /> : <div className="max-h-64 space-y-2 overflow-y-auto">
          {conversations.map((conversation) => (
            <button key={conversation.id} type="button" onClick={() => void openConversation(conversation.id)} className={[
              'w-full truncate rounded-xl border px-3 py-2.5 text-left text-sm',
              detail?.conversation.id === conversation.id ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-100' : 'border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-600',
            ].join(' ')}>
              <span className="block truncate">{conversation.title}</span>
              <span className="mt-1 block text-xs text-slate-500">{new Date(conversation.updatedAt).toLocaleDateString()}</span>
            </button>
          ))}
          {conversations.length === 0 ? <p className="text-sm text-slate-500">No conversations yet.</p> : null}
        </div>}
        <div className="flex items-center gap-2 text-cyan-300">
          <Sparkles className="h-4 w-4" />
          <p className="text-xs uppercase tracking-[0.28em]">Suggested prompts</p>
        </div>

        <div className="space-y-3">
          {promptIdeas.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => setDraft(prompt)}
              className="w-full rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-left text-sm text-slate-200 hover:border-cyan-500/30 hover:text-white"
            >
              {prompt}
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}
