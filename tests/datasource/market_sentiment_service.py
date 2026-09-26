from data_provider import DataFetcherManager

manager = DataFetcherManager()          # 无参构造，自动按优先级注册所有 fetcher
rows = manager.get_main_indices(region='cn')     # 指数行情
stats = manager.get_market_stats(purpose='demo') # 涨跌统计