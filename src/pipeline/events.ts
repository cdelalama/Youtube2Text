export type PipelineStage =
  | "download"
  | "split"
  | "transcribe"
  | "format"
  | "comments"
  | "save";

export type PipelineEvent =
  | {
      type: "run:start";
      runId?: string;
      inputUrl: string;
      channelId: string;
      channelTitle?: string;
      channelDirName?: string;
      totalVideos: number;
      alreadyProcessed: number;
      remaining: number;
      channelTotalVideos?: number;
      channelAlreadyProcessed?: number;
      channelUnprocessed?: number;
      timestamp: string;
    }
  | {
      type: "video:start";
      videoId: string;
      title: string;
      url: string;
      index: number;
      total: number;
      timestamp: string;
    }
  | {
      type: "video:stage";
      videoId: string;
      stage: PipelineStage;
      index: number;
      total: number;
      timestamp: string;
    }
  | {
      type: "video:skip";
      videoId: string;
      basename: string;
      reason: string;
      index: number;
      total: number;
      completed: number;
      remaining: number;
      timestamp: string;
    }
  | {
      type: "video:done";
      videoId: string;
      basename: string;
      index: number;
      total: number;
      completed: number;
      remaining: number;
      timestamp: string;
    }
  | {
      type: "video:error";
      videoId: string;
      basename: string;
      error: string;
      stage?: PipelineStage;
      index: number;
      total: number;
      completed: number;
      remaining: number;
      timestamp: string;
    }
  | {
      type: "run:done";
      channelId: string;
      total: number;
      succeeded: number;
      failed: number;
      skipped: number;
      timestamp: string;
    }
  | {
      type: "run:cancelled";
      channelId: string;
      total: number;
      succeeded: number;
      failed: number;
      skipped: number;
      timestamp: string;
    }
  | {
      type: "run:error";
      channelId?: string;
      error: string;
      timestamp: string;
    };

export interface PipelineEventEmitter {
  emit(event: PipelineEvent): void;
}
