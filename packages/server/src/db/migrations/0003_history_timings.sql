-- İstek süre dökümü: ExecuteTimings JSON'u. Eski kayıtlarda NULL kalır.
ALTER TABLE history ADD COLUMN timings_json TEXT;
