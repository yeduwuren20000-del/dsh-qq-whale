from runtime_log import cleanup,write_event
result=cleanup();write_event('log_cleanup',**result)
