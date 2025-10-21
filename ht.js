const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let rows=10, cols=10, cellSize=canvas.width/cols;
let maze=[], player={x:0,y:0}, exit={x:cols-1,y:rows-1}, timeLeft=120, level=1;
let animBlocks=[]; // moving grey blocks

const timerDisplay = document.getElementById('timerDisplay');

function shuffle(array){
    for(let i=array.length-1;i>0;i--){
        const j=Math.floor(Math.random()*(i+1));
        [array[i], array[j]]=[array[j], array[i]];
    }
    return array;
}

function generateMaze(){
    maze=Array.from({length:rows},()=>Array.from({length:cols},()=>0));

    // Static walls (light grey)
    for(let i=0;i<Math.floor(level*3);i++){
        let x=Math.floor(Math.random()*cols);
        let y=Math.floor(Math.random()*rows);
        if((x===0 && y===0) || (x===exit.x && y===exit.y)) continue;
        maze[y][x]=1;
    }

    // Moving grey blocks
    animBlocks=[];
    let maxBlocks = Math.floor(rows*cols/3);
    let blockCount = Math.min(10 + level*2, maxBlocks);
    const tries = rows*cols*2;
    let attempts = 0;
    while(animBlocks.length < blockCount && attempts < tries){
        attempts++;
        let bx=Math.floor(Math.random()*cols);
        let by=Math.floor(Math.random()*rows);
        if(maze[by][bx]===0 && !(bx===0&&by===0) && !(bx===exit.x&&by===exit.y)){
            // avoid duplicates
            if(!animBlocks.some(b=>b.x===bx && b.y===by)){
                maze[by][bx]=2;
                animBlocks.push({x:bx, y:by, drawX:bx, drawY:by});
            }
        }
    }

    player={x:0,y:0};
    // reduce time slightly each level but keep a floor
    timeLeft = Math.max(30, 120 - (level-1)*5);
}

function draw(){
    ctx.clearRect(0,0,canvas.width,canvas.height);

    for(let y=0;y<rows;y++){
        for(let x=0;x<cols;x++){
            if(maze[y][x]===1) ctx.fillStyle='#999'; // static wall
            else ctx.fillStyle='#fff'; // empty
            ctx.fillRect(x*cellSize, y*cellSize, cellSize-2, cellSize-2);
        }
    }

    // draw moving blocks smoothly
    ctx.fillStyle='#777';
    animBlocks.forEach(b=>{
        b.drawX += (b.x - b.drawX)*0.2;
        b.drawY += (b.y - b.drawY)*0.2;
        ctx.fillRect(b.drawX*cellSize, b.drawY*cellSize, cellSize-2, cellSize-2);
    });

    // player = yellow coin
    ctx.fillStyle='gold';
    ctx.beginPath();
    ctx.arc(player.x*cellSize + cellSize/2, player.y*cellSize + cellSize/2, cellSize/3, 0, Math.PI*2);
    ctx.fill();

    // exit = green
    ctx.fillStyle='lime';
    ctx.fillRect(exit.x*cellSize, exit.y*cellSize, cellSize-2, cellSize-2);

    timerDisplay.innerText = `Time Left: ${timeLeft}s  |  Level: ${level}`;
}

// return true if cell is empty (no wall, no moving block, not exit, not player)
function isEmptyCell(x,y){
    if(x<0||x>=cols||y<0||y>=rows) return false;
    if(maze[y][x]===1) return false; // static wall
    if(x===player.x && y===player.y) return false;
    if(x===exit.x && y===exit.y) return false;
    // ensure not occupied by animBlocks
    if(animBlocks.some(b => b.x===x && b.y===y)) return false;
    return true;
}

// Player movement and push logic (Sokoban-like single push)
function movePlayer(dx,dy){
    const nx=player.x+dx, ny=player.y+dy;
    if(nx<0||nx>=cols||ny<0||ny>=rows) return;
    if(maze[ny][nx]===1) return; // static wall

    if(maze[ny][nx]===2){
        // there's a moving block there - attempt to push one cell in same dir if empty
        const tx = nx + dx, ty = ny + dy;
        if(tx<0||tx>=cols||ty<0||ty>=rows) return;
        if(maze[ty][tx]===0 && !animBlocks.some(b=>b.x===tx && b.y===ty) && !(tx===player.x && ty===player.y) && !(tx===exit.x && ty===exit.y)){
            // push block
            maze[ny][nx]=0;
            const block = animBlocks.find(b=>b.x===nx && b.y===ny);
            if(block){ block.x = tx; block.y = ty; maze[ty][tx]=2; }
            player.x = nx; player.y = ny;
        } else {
            // can't push
            return;
        }
    } else {
        // empty space
        player.x = nx; player.y = ny;
    }
    draw();
    checkExit();
}

// Controls
document.addEventListener('keydown', e => {
    if(e.key === 'ArrowUp') movePlayer(0, -1);
    if(e.key === 'ArrowDown') movePlayer(0, 1);
    if(e.key === 'ArrowLeft') movePlayer(-1, 0);
    if(e.key === 'ArrowRight') movePlayer(1, 0);
});
document.querySelectorAll('.mobile-controls button').forEach(btn=>{
    btn.addEventListener('click', ()=>{
        const dir = btn.dataset.dir;
        if(dir==='up') movePlayer(0,-1);
        if(dir==='down') movePlayer(0,1);
        if(dir==='left') movePlayer(-1,0);
        if(dir==='right') movePlayer(1,0);
    });
});

// NEW: robust auto-move ensuring as many blocks as possible move each tick.
// Strategy:
// 1. Build a list of candidate empty cells (not walls, not player, not exit).
// 2. Shuffle candidates and assign each block a distinct target (different from its current cell).
// 3. If not enough empty cells, attempt local moves (adjacent) first.
// 4. Update maze and animate via drawX/drawY interpolation.
function autoMoveBlocks(){
    // collect all currently empty target cells (maze===0) excluding player & exit & block current positions
    const emptyCells = [];
    for(let y=0;y<rows;y++){
        for(let x=0;x<cols;x++){
            if(isEmptyCell(x,y)) emptyCells.push({x,y});
        }
    }
    shuffle(emptyCells);

    // We'll create targets array same length as animBlocks; initialize with null
    const targets = new Array(animBlocks.length).fill(null);

    // First pass: try to assign adjacent moves (preferred local moves) so motion looks natural
    const dirs = [[0,-1],[0,1],[-1,0],[1,0]];
    const order = shuffle(animBlocks.map((_,i)=>i)); // randomize processing order each tick

    for(const idx of order){
        const b = animBlocks[idx];
        // look for adjacent empty cells
        const adjOptions = shuffle(dirs.map(d=>({x:b.x+d[0], y:b.y+d[1], dx:d[0], dy:d[1]}))
            .filter(o => isEmptyCell(o.x,o.y)));
        if(adjOptions.length>0){
            const o = adjOptions[0];
            targets[idx] = {x:o.x, y:o.y};
            // reserve that cell so other blocks don't take it
            // remove from emptyCells if present
            const rem = emptyCells.findIndex(c=>c.x===o.x && c.y===o.y);
            if(rem>-1) emptyCells.splice(rem,1);
        }
    }

    // Second pass: for remaining blocks try to assign any random empty cell (teleport-style) to ensure movement
    const remainingIdxs = [];
    for(let i=0;i<animBlocks.length;i++) if(!targets[i]) remainingIdxs.push(i);
    for(const idx of remainingIdxs){
        if(emptyCells.length===0) break;
        const cell = emptyCells.pop(); // already shuffled
        targets[idx] = {x:cell.x, y:cell.y};
    }

    // Third pass: for any still without a target, try to pick any adjacent cell even if currently occupied by another block
    // (we attempt to swap by finding chain of moves; simple approach: try opposite direction of blocked neighbors)
    for(let i=0;i<targets.length;i++){
        if(targets[i]) continue;
        const b = animBlocks[i];
        // try any adjacent cell that's not a static wall and not exit/player (may be occupied by block)
        const adj = shuffle(dirs.map(d=>({x:b.x+d[0], y:b.y+d[1], dx:d[0], dy:d[1]}))
            .filter(o => {
                if(o.x<0||o.x>=cols||o.y<0||o.y>=rows) return false;
                if(maze[o.y][o.x]===1) return false; // static wall
                if(o.x===exit.x && o.y===exit.y) return false;
                if(o.x===player.x && o.y===player.y) return false;
                return true;
            }));
        if(adj.length>0){
            // choose first and we'll resolve conflicts by swapping positions
            targets[i] = {x:adj[0].x, y:adj[0].y};
        }
    }

    // Build a map of new positions to detect conflicts and decide final moves
    const newPosMap = {};
    // First clear old maze positions for blocks - we'll set them after deciding final positions
    animBlocks.forEach(b => { maze[b.y][b.x] = 0; });

    // Apply targets: if multiple blocks target same cell, we'll keep the first and for others pick nearest free adjacent or their original cell
    for(let i=0;i<animBlocks.length;i++){
        const b = animBlocks[i];
        let t = targets[i];
        if(!t){
            // no target at all -> keep in place (but we'll still animate small jitter by keeping drawX/Y)
            maze[b.y][b.x] = 2;
            continue;
        }
        const key = `${t.x},${t.y}`;
        if(!newPosMap[key]){
            // accept
            newPosMap[key] = i;
            b.x = t.x; b.y = t.y;
            maze[b.y][b.x] = 2;
        } else {
            // conflict: try to find an adjacent empty cell to assign
            let assigned = false;
            const adj = shuffle([[0,-1],[0,1],[-1,0],[1,0]]);
            for(const d of adj){
                const ax = b.x + d[0], ay = b.y + d[1];
                if(isEmptyCell(ax,ay) && !newPosMap[`${ax},${ay}`]){
                    b.x = ax; b.y = ay;
                    maze[b.y][b.x] = 2;
                    newPosMap[`${ax},${ay}`] = i;
                    assigned = true;
                    break;
                }
            }
            if(!assigned){
                // give it its original cell again
                maze[b.y][b.x] = 2;
            }
        }
    }

    // At this point maze updated with new block positions; draw loop will interpolate drawX/drawY
}

// Auto move timer (interval shortens as level increases but never below 400ms)
function getAutoMoveInterval(){
    return Math.max(2000 - (level-1)*150, 400);
}

let autoMoveTimer = setInterval(()=>{ autoMoveBlocks(); }, getAutoMoveInterval());

// If level changes we should reset the interval
function resetAutoMoveInterval(){
    clearInterval(autoMoveTimer);
    autoMoveTimer = setInterval(()=>{ autoMoveBlocks(); }, getAutoMoveInterval());
}

function checkExit(){
    if(player.x===exit.x && player.y===exit.y){
        alert('Level Up!');
        level++;
        generateMaze();
        resetAutoMoveInterval();
        draw();
    }
}

// Timer
let timerInterval = setInterval(()=>{
    timeLeft--;
    if(timeLeft<=0){
        alert('Time Up!');
        generateMaze();
        resetAutoMoveInterval();
    }
    draw();
},1000);

function gameLoop(){
    draw();
    requestAnimationFrame(gameLoop);
}

generateMaze();
gameLoop();
