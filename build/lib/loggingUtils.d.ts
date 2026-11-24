/**
 * Utility functions for logging management
 */
/**
 * Create a logging wrapper that can filter connection error messages
 *
 * @param originalLog - The original logger object
 * @param disableLogging - Whether to disable connection error logging
 * @returns The wrapped logger or original logger
 */
export declare function createLoggingWrapper(originalLog: ioBroker.Logger, disableLogging?: boolean): ioBroker.Logger;
