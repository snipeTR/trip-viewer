-- The `settings` table held a mix of per-machine and per-archive state.
-- Per-machine keys (ffmpeg_path, ffmpeg_version, nvenc_hevc,
-- timelapse_max_concurrent_jobs) moved to app_data_dir/settings.json in
-- the prior change. `library_root` was a derived cache used by the
-- timelapse worker to find <archive>/Timelapses/ — but with the DB now
-- living *inside* the archive, the archive root is implicit (it's the
-- DB's grandparent: <archive>/.tripviewer/tripviewer.db). No surviving
-- callers; no future per-archive keys planned for this slot. Drop.

DROP TABLE IF EXISTS settings;
