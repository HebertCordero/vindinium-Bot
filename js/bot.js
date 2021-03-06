#!/usr/bin/env node

var printf = require('printf');
var Board = require('./board');
var pathing = require('./pathing');

// Decide on next turn.
module.exports = function bot(s, cb) {
    var start = Date.now();
    var dir = run(s);
    s.context.ms = Date.now() - start;
    cb(null, dir);
};

function run(s) {
    augment(s);

    var hero = s.hero;
    var board = s.game.board;

    var best = null;
    function goal(action, tile, path, score) {
        if (best && best.score >= score) return;
        best = { action: action, tile: tile, path: path, score: score };
    }

    // How badly we want to heal, or dodge towards a tavern.
    var shouldRun = hero.mineCount && tileDanger(s, hero.tile, 0);
    var shouldHeal = hero.life <= 80 && (hero.gold >= 2 || hero.mineCount);
    if (shouldRun || shouldHeal) {
        board.taverns.forEach(function(tile) {
            var path = pathing(s, s.hero.tile, tile, tileCost);
            if (path)
                goal('heal', tile, path,
                    (shouldRun ? 100 : 80 - hero.life) - path.length);
        });
    }

    if (hero.life > 20) {
        // How important are the mines.
        board.mines.forEach(function(tile) {
            // If it's ours, never mind.
            if (tile.chr[1] === hero.idStr) return;

            var path = pathing(s, s.hero.tile, tile, tileCost);
            if (path) {
                goal('mine', tile, path,
                    Math.max(11 - path.length, 1) * 4);
            }
        });

        // Look for kill opportunities.
        s.game.heroes.forEach(function(douche) {
            // Let's not stab ourselves.
            if (douche === hero) return;
            // Don't bother unless we have something to gain.
            if (douche.mineCount === 0) return;
            // If we'll lose, never mind.
            if (douche.life > 20 && douche.life > hero.life) return;

            var path = pathing(s, s.hero.tile, douche.tile, tileCost);
            if (path) {
                var dist = path.length;

                // If the path length is uneven, consider the first hit.
                if (douche.life > 20 && dist === 3 &&
                    douche.life > hero.life - 20) return;

                goal('kill', douche.tile, path,
                    Math.max(11 - path.length, 0) * 5);
            }
        });
    }

    // Execute best goal.
    s.context.goal = best;
    return best && best.path[0];
}

// Check for a nearby danger from enemies.
function tileDanger(s, tile, lifePenalty) {
    var hero = s.hero;
    var heroLife = hero.life - lifePenalty;
    if (tile.isNear('[]')) heroLife += 50;

    var res = 0;
    s.game.heroes.forEach(function(douche) {
        if (douche === s.hero) return;
        if (douche.life <= 20) return;

        // Find douches that have potential to hunt us.
        var path = pathing(s, douche.tile, tile, null, 3);
        if (path) {
            var dist = path.length;

            // Never fight an enemy next to a tavern.
            if (dist === 1 && douche.tile.isNear('[]')) {
                res += 5;
            }
            // Keep a safe distance from healthier douches.
            else {
                var safeLife = heroLife;
                if (dist === 3)
                    safeLife -= 20;
                if (douche.life > safeLife)
                    res += Math.max(res, 4 - dist);
            }
        }
    });
    return res;
}

// Heuristic cost calculation during pathing.
// Avoid dangerous tiles, and get the closest to the goal.
function tileCost(s, tile, goal, from) {
    var nextTile = (tile.chr === '  ') ? tile : from;
    var lifePenalty = (tile.chr[0] === '$') ? 20 : 0;
    return tile.dist(goal) + tileDanger(s, nextTile, lifePenalty) * 50;
}

// Do a bunch of augmentations on game state.
function augment(s) {
    var board = s.game.board = new Board(s.game.board);

    s.game.heroes.forEach(function(douche) {
        if (douche.id === s.hero.id)
            s.hero = douche;

        var idStr = String(douche.id);
        douche.idStr = idStr;

        var pos = douche.pos;
        douche.tile = board.get(pos.x, pos.y);

        var spawnPos = douche.spawnPos;
        douche.spawnTile = board.get(spawnPos.x, spawnPos.y);

        douche.mines = board.mines.filter(function(tile) {
            return tile.chr[1] === douche.idStr;
        });
    });
}

// Run CLI if main.
if (require.main === module) {
    var cli = require('vindinium-client').cli;
    cli(module.exports, function(ev, arg) {
        if (ev === 'turn') {
            var turn = Math.floor(arg.game.turn / 4);
            var goal = arg.context.goal;
            var hero = arg.hero;          
            var str = printf(' --T------HP--------GP----POSITION-------GOAL--------PATH---- \n|%3d     %3d     %4d     (%2d,%2d)       ',
                turn, hero.life, hero.gold, hero.pos.x, hero.pos.y);
            if (goal)
                str += printf('%5s      (%2d,%2d)   |\n ------------------------------------------------------------ ',
                    goal.action, goal.tile.x, goal.tile.y, goal.score);
            else
                str += ' idle                   ';
            //str += printf('   %4d ms', arg.context.ms);
            console.log(str);
            process.stdout.write("\r\x1b[K");
        }
        else if (ev === 'queue') {
            console.log('### QUEUE - Waiting for players...');
        }
        else if (ev === 'start') {
            console.log('### START - ' + arg.viewUrl);
        }
        else if (ev === 'end') {
            console.log('### ' + cli.ranking(arg));
        }
        else if (ev === 'graceful') {
            console.log('\r### SIGINT - Finishing running matches. Press again to abort.');
        }
        else if (ev === 'abort') {
            console.log('\r### SIGINT - Matches aborted.');
        }
        else if (ev === 'error') {
            console.error('### ERROR - ' + (arg.stack || arg.message || arg));
        }
    });
}
