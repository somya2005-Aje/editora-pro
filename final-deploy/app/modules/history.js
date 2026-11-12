/* Editora Pro — reversible-command history (Phase 0+1)
   One shared undo/redo implementation for both editors. Snapshot-based:
   each command pushes a serialized document snapshot; undo/redo restores
   a snapshot. The editors keep owning their own serialize/restore
   functions — this module only owns the stack discipline (cap, lock
   during restore so a restore never records itself, clear, canUndo/
   canRedo). Classic script; load before app.js / photo.js.
   Two modes (the editors historically differ — preserved exactly):
   - mode "post" (video editor): push() is called AFTER an edit and
     records the post-edit state. undo() steps back to the previous
     post-edit state; redo() steps forward. The initial state must be
     pushed once at load (app.js init does this) for the first edit to
     be undoable.
   - mode "pre" (photo editor): push() is called BEFORE an edit and
     records the pre-edit state (a checkpoint). undo() stashes the
     current state for redo and restores the last checkpoint; redo()
     stashes the current state and restores the stashed one.
   Usage:
     const hist = EPHistory.create(serializeFn, restoreFn, {limit: 60, mode: "post"});
     hist.push();            // record (no-op while locked)
     hist.undo();            // Promise<boolean> — true if it undid
     hist.redo();            // Promise<boolean>
     hist.clear(); hist.canUndo(); hist.canRedo(); hist.length();
   restoreFn may be sync or return a Promise; undo/redo await it. */
(function(){
"use strict";
function EPHistory(serialize, restore, opts){
  opts=opts||{};
  this._serialize=serialize;
  this._restore=restore;
  this.limit=opts.limit||60;
  this.mode=opts.mode==="pre"?"pre":"post";
  this._stack=[];
  this._redo=[];
  this._index=-1; /* post mode only: position of the current state */
  this._lock=false;
}
EPHistory.prototype._apply=function(snap){
  var self=this;
  this._lock=true;
  var done=function(){self._lock=false;};
  try{
    var r=this._restore(snap);
    if(r&&typeof r.then==="function")return r.then(function(){done();return true;},function(e){done();throw e;});
  }catch(e){done();return Promise.reject(e);}
  done();
  return Promise.resolve(true);
};
EPHistory.prototype._snap=function(){
  try{return this._serialize();}catch(e){return null;}
};
EPHistory.prototype.push=function(){
  if(this._lock)return false;
  var snap=this._snap();
  if(snap===null||snap===undefined)return false;
  if(this.mode==="pre"){
    this._redo.length=0;
    this._stack.push(snap);
    if(this._stack.length>this.limit)this._stack.shift();
  }else{
    this._stack=this._stack.slice(0,this._index+1);
    this._stack.push(snap);
    if(this._stack.length>this.limit)this._stack.shift();
    this._index=this._stack.length-1;
  }
  return true;
};
EPHistory.prototype.undo=function(){
  var self=this;
  if(this.mode==="pre"){
    if(!this._stack.length)return Promise.resolve(false);
    var cur=this._snap();
    if(cur!==null&&cur!==undefined)this._redo.push(cur);
    var snap=this._stack.pop();
    return this._apply(snap);
  }
  if(this._index<=0)return Promise.resolve(false);
  this._index--;
  return this._apply(this._stack[this._index]);
};
EPHistory.prototype.redo=function(){
  if(this.mode==="pre"){
    if(!this._redo.length)return Promise.resolve(false);
    var cur=this._snap();
    if(cur!==null&&cur!==undefined)this._stack.push(cur);
    var snap=this._redo.pop();
    return this._apply(snap);
  }
  if(this._index>=this._stack.length-1)return Promise.resolve(false);
  this._index++;
  return this._apply(this._stack[this._index]);
};
EPHistory.prototype.clear=function(){this._stack=[];this._redo=[];this._index=-1;};
EPHistory.prototype.canUndo=function(){return this.mode==="pre"?this._stack.length>0:this._index>0;};
EPHistory.prototype.canRedo=function(){return this.mode==="pre"?this._redo.length>0:this._index<this._stack.length-1;};
EPHistory.prototype.length=function(){return this._stack.length;};
EPHistory.prototype.locked=function(){return this._lock;};
EPHistory.create=function(serialize,restore,opts){return new EPHistory(serialize,restore,opts);};
window.EPHistory=EPHistory;
})();
