// 大盘情绪页 API 封装 — /api/v1/market-sentiment/*
import apiClient from './index';

export interface SentimentTemperature {
  st: number | null;
  trend: number | null;
}

export interface SentimentAmount {
  total: number | null;       // 亿元
  sh: number | null;
  sz: number | null;
  vs_prev_pct: number | null; // 较前日 %
}

export interface SentimentAdvanceDecline {
  up: number | null;
  down: number | null;
  flat: number | null;
  limit_up: number | null;
  limit_down: number | null;
  blown_rate: number | null;
}

export interface SentimentInflow {
  main: number | null;
  north: number | null;
}

export interface SentimentIndices {
  hs300_close: number | null;
  hs300_chg_pct: number | null;
  sh50_chg_pct: number | null;
  chinext_chg_pct: number | null;
  sh_close: number | null;      // 上证指数收盘点位
  sh_chg_pct: number | null;    // 上证指数涨跌幅 %
}

export interface RealtimeIndexItem {
  code: string | null;
  name: string | null;
  current: number | null;
  change: number | null;
  change_pct: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  prev_close: number | null;
  volume: number | null;
  amount: number | null;
  amplitude: number | null;
}

export interface SentimentRealtime {
  indices: RealtimeIndexItem[];
  market_stats: Record<string, unknown> | null;
}

export interface SentimentOverseas {
  spx_chg: number | null;     // 标普500 涨跌幅 %
  ndx_chg: number | null;     // 纳斯达克综合 %
  dji_chg: number | null;     // 道琼斯 %
  vix: number | null;         // VIX 点位
  kospi_chg: number | null;   // KOSPI %
  kosdaq_chg: number | null;  // KOSDAQ %
}

export interface SentimentOverview {
  trade_date: string;
  is_complete: boolean;
  market_phase: string | null;   // premarket/intraday/lunch_break/closing_auction/postmarket/non_trading/unknown
  temperature: SentimentTemperature;
  amount: SentimentAmount;
  advance_decline: SentimentAdvanceDecline;
  inflow: SentimentInflow;
  indices: SentimentIndices;
  new_high_60d: number | null;
  new_low_60d: number | null;
  overseas: SentimentOverseas | null;
  realtime: SentimentRealtime | null;
  degraded: string[];
}

export interface SentimentTrendPoint {
  trade_date: string;
  sentiment_st: number | null;
  sentiment_trend: number | null;
  total_amount: number | null;
  up_count: number | null;
  down_count: number | null;
  limit_up_count: number | null;
  limit_down_count: number | null;
  hs300_chg_pct: number | null;
}

export interface SentimentTrendResponse {
  items: SentimentTrendPoint[];
  days: number;
}

export interface LadderPoint {
  trade_date: string;
  height_1: number | null;
  height_2: number | null;
  height_3: number | null;
  height_4: number | null;
  height_5plus: number | null;
  max_height: number | null;
  max_height_code: string | null;
  max_height_name: string | null;
  ladder_complete: number | null;
  first_seal_dist: Record<string, number> | null;
  sector_dist: { sector: string; count: number }[] | null;
  prev_limit_up_total: number | null;
  prev_limit_up_again: number | null;
  prev_limit_up_blown: number | null;
  prev_limit_up_down: number | null;
}

export interface LadderTrendResponse {
  items: LadderPoint[];
  days: number;
}

export interface LimitUpPoolItem {
  code: string;
  name: string;
  change_pct: number | null;
  price: number | null;
  amount: number | null;          // 元
  turnover_rate: number | null;
  seal_amount: number | null;     // 元
  first_limit_time: string;       // 'HHMMSS'
  last_limit_time: string;
  break_count: number;
  limit_stat: string;
  consecutive_boards?: number | null;      // 涨停池=连板数
  continuous_down_days?: number | null;    // 跌停池=连续跌停天数
  industry: string;
}

export type PoolType = 'limit_up' | 'limit_down' | 'blown';

export interface LadderTodayResponse {
  snapshot: LadderPoint | null;
  pool: LimitUpPoolItem[];
  pool_type: PoolType;
  pool_source: 'snapshot' | 'realtime' | 'snapshot_prev' | null;
  degraded: string[];
}

export interface FocusEventItem {
  event_date: string;
  title: string;
  source: string | null;
  event_type: string | null;
  sentiment: string | null;
  related_sectors: string[];
  related_stocks: string[];
  impact_label: string | null;
  impact_magnitude: string | null;
  summary: string | null;
}

export interface FocusStockItem {
  stock_code: string;
  stock_name: string | null;
  concept_tags: string[];
  boards: number | null;
  reason: string | null;
  chg_pct: number | null;
  turnover_rate: number | null;
  main_inflow: number | null;
  dragon_tiger: number | null;
  inst_buy: number | null;
}

export interface FocusSectorItem {
  sector_name: string;
  chg_pct: number | null;
  main_inflow: number | null;
  leader_code: string | null;
  leader_name: string | null;
  limit_up_trend: number[] | null;
  lifecycle_stage: string | null;
  lifecycle_day: number | null;
}

export type FocusScope = 'week' | 'month';

export interface FocusResponse {
  scope: FocusScope;
  events: FocusEventItem[];
  review_events: FocusEventItem[];   // 上一周期热点回顾（延续关注）
  stocks: FocusStockItem[];
  sectors: FocusSectorItem[];
  degraded: string[];
}

export interface TomorrowFocus {
  for_date: string;
  key_events: { time?: string; code?: string; title: string; impact?: string; sentiment?: string }[];
  sector_watch: { name: string; status: string; reason: string }[];
  stock_watch: { code: string; name: string; concept?: string; watch_type: string; label: string; reason?: string }[];
  ai_preview: string | null;
  generated_at: string | null;
}

export interface CollectResponse {
  trade_date: string;
  snapshot_id: number | null;
  sentiment_st: number | null;
  sentiment_trend: number | null;
  limit_up_pool_size: number;
  focus_stocks: number;
  focus_sectors: number;
  degraded: string[];
  tomorrow_generated: boolean;
}

export const sentimentApi = {
  async getOverview(realtime = false): Promise<SentimentOverview> {
    const resp = await apiClient.get<SentimentOverview>(
      '/api/v1/market-sentiment/overview',
      { params: realtime ? { realtime: true } : undefined },
    );
    return resp.data;
  },

  async getTrend(days = 10): Promise<SentimentTrendResponse> {
    const resp = await apiClient.get<SentimentTrendResponse>(
      '/api/v1/market-sentiment/trend',
      { params: { days } },
    );
    return resp.data;
  },

  async getLadderTrend(days = 5): Promise<LadderTrendResponse> {
    const resp = await apiClient.get<LadderTrendResponse>(
      '/api/v1/market-sentiment/limit-ladder',
      { params: { days } },
    );
    return resp.data;
  },

  async getLadderToday(poolType: PoolType = 'limit_up'): Promise<LadderTodayResponse> {
    const resp = await apiClient.get<LadderTodayResponse>(
      '/api/v1/market-sentiment/limit-ladder/today',
      { params: { pool_type: poolType } },
    );
    return resp.data;
  },

  async getFocus(scope: FocusScope): Promise<FocusResponse> {
    const resp = await apiClient.get<FocusResponse>(
      '/api/v1/market-sentiment/focus',
      { params: { scope } },
    );
    return resp.data;
  },

  async getTomorrow(): Promise<TomorrowFocus | null> {
    const resp = await apiClient.get<TomorrowFocus | null>(
      '/api/v1/market-sentiment/tomorrow',
    );
    return resp.data;
  },
};
