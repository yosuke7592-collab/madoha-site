const source = (url, title) => ({ type: 'url', url, title });

function response({ id, text = '', sources = [], status = 'success', error = null, input = 250, output = 350 }) {
  const annotations = sources.slice(0, 2).map((item, index) => ({
    type: 'url_citation', start_index: index * 10, end_index: index * 10 + 8,
    url: item.url, title: item.title
  }));
  return {
    id, object: 'response', created_at: 1787014800, status: status === 'failed' ? 'failed' : status === 'partial' ? 'incomplete' : 'completed',
    model: 'gpt-5.6-luna', fixtureStatus: status, fixtureError: error,
    output: status === 'failed' ? [] : [
      { type: 'web_search_call', id: `ws_${id}`, status: 'completed', action: { type: 'search', query: 'fixture query', sources } },
      { type: 'message', id: `msg_${id}`, role: 'assistant', status: status === 'partial' ? 'incomplete' : 'completed', content: [{ type: 'output_text', text, annotations }] }
    ],
    usage: { input_tokens: input, output_tokens: output, total_tokens: input + output }
  };
}

export function openAiFixtureFor(query, repetition) {
  const id = `openai-fixture-${query.intent}-r${repetition}`;
  const target = source(`https://setagayahome.co.jp/cases/${query.intent}`, `世田谷ホーム ${query.intent}`);
  const competitor = source('https://comparison.example/setagaya-paint', '世田谷区の外壁塗装比較');
  if (repetition === 1) return response({
    id, text: 'おすすめ候補は次の通りです。\n1. 世田谷ホーム\n2. 東京ペイント', sources: [target, competitor]
  });
  if (repetition === 2) return response({
    id, text: '比較候補として東京ペイントと世田谷リフォームが確認できます。', sources: [competitor]
  });
  if (query.intent === 'qualification') return response({ id, status: 'partial', text: '世田谷ホームについて確認しましたが、引用は取得できませんでした。' });
  if (query.intent === 'subsidy') return response({ id, status: 'failed', error: { code: 'fixture_provider_error', message: 'Synthetic OpenAI provider failure.', retryable: false } });
  return response({ id, text: '候補として世田谷ホームを確認しました。', sources: [target] });
}
