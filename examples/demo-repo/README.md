# demo-jobs

A tiny job queue. Workers call `claimNext(workerId)` to take the oldest pending job.
**Each job must be claimed by exactly one worker**; a claimed job is never handed out again.
