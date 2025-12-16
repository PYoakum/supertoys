# MTLS Proxy


## Start MTLS Proxy

```bash
--listen 127.0.0.1:8443 \
  --upstream http://localhost:3000 \
  --server-cert certs/server-cert.pem \
  --server-key certs/server-key.pem \
  --client-ca certs/ca-cert.pem
```

```bash
  curl --cacert certs/ca-cert.pem \
  --cert certs/client-cert.pem \
  --key certs/client-key.pem \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"key": "value"}' \
  https://localhost:8443/api/endpoint
```