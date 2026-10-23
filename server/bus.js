import { EventEmitter } from 'node:events';

/**
 * In-process notifications from the game/tournament logic to the socket layer.
 *   'game'        (gameId)                  a game's state changed
 *   'tournament'  (tournamentId)            pairings, standings or status changed
 *   'round'       ({ tournament, games })   a new round was paired
 *   'announce'    (text)                    post a club announcement to the chat
 */
export const bus = new EventEmitter();
