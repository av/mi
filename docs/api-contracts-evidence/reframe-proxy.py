# pass-through for a local OpenAI-compatible server that re-frames every SSE event the way the SSE standard allows:
# the event's JSON is spread over several "data:" lines (the receiver must join them with newlines before parsing).
# The content of the events is the server's own, unchanged.   python3 reframe-proxy.py PORT UPSTREAM LOGDIR
import http.server, sys, json, urllib.request, itertools, os
N=itertools.count(1); UP=sys.argv[2].rstrip('/'); LOG=sys.argv[3]; os.makedirs(LOG,exist_ok=True)
class H(http.server.BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    def do_POST(self):
        body=self.rfile.read(int(self.headers.get('content-length',0))); i=next(N); tag=f"{LOG}/{i:03d}"
        open(tag+'.request.json','wb').write(body)
        r=urllib.request.Request(UP+self.path, body, {'Authorization':'Bearer x','Content-Type':'application/json'})
        try: resp=urllib.request.urlopen(r,timeout=900)
        except urllib.error.HTTPError as e:
            data=e.read(); open(tag+'.response.txt','wb').write(b'HTTP %d\n'%e.code+data); self.send_response(e.code); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(data))); self.end_headers(); self.wfile.write(data); return
        self.send_response(200); self.send_header('Content-Type','text/event-stream'); self.send_header('Transfer-Encoding','chunked'); self.end_headers()
        with open(tag+'.upstream.txt','wb') as up, open(tag+'.response.txt','wb') as f:
            for raw in resp.read().decode().split('\n\n'):
                up.write(raw.encode()+b'\n\n')
                if not raw.startswith('data: '): continue
                payload=raw[6:]
                out=raw if payload=='[DONE]' else '\n'.join('data: '+l for l in json.dumps(json.loads(payload),indent=1).split('\n'))
                chunk=(out+'\n\n').encode(); f.write(chunk); self.wfile.write(b'%x\r\n'%len(chunk)+chunk+b'\r\n'); self.wfile.flush()
            self.wfile.write(b'0\r\n\r\n')
    def log_message(self,*a): pass
http.server.ThreadingHTTPServer(('127.0.0.1',int(sys.argv[1])),H).serve_forever()
