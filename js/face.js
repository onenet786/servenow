// Face reading for attendance, in the browser (face-api, MIT licence, hosted in js/vendor/face). A face
// becomes 128 numbers on this PC; the numbers go to our server, which does the matching. The library is
// about 8 MB, so it only loads on the screens that need it.
window.ServeNowFace = (function () {
  const BASE = '/js/vendor/face';
  let ready = null;

  const addScript = (src) => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Could not load face recognition.'));
    document.head.append(script);
  });

  const detectorOptions = () => new window.faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 });

  // The first read prepares the graphics card and can take 20 seconds; later reads take a fraction of a
  // second. That wait belongs here, on a blank picture, and not in front of the day's first employee.
  async function warmUp() {
    const blank = document.createElement('canvas');
    blank.width = 150;
    blank.height = 150;
    blank.getContext('2d').fillRect(0, 0, 150, 150);
    const { nets } = window.faceapi;
    await nets.tinyFaceDetector.locateFaces(blank, detectorOptions());
    await nets.faceLandmark68Net.detectLandmarks(blank);
    await nets.faceRecognitionNet.computeFaceDescriptor(blank);
  }

  function load() {
    ready = ready || (async () => {
      if (!window.faceapi) await addScript(`${BASE}/face-api.js`);
      const { tf, nets } = window.faceapi;
      await tf.setBackend('webgl').catch(() => tf.setBackend('cpu'));
      await tf.ready();
      await Promise.all([
        nets.tinyFaceDetector.loadFromUri(`${BASE}/models`),
        nets.faceLandmark68Net.loadFromUri(`${BASE}/models`),
        nets.faceRecognitionNet.loadFromUri(`${BASE}/models`),
      ]);
      await warmUp();
    })().catch((error) => {
      ready = null;
      throw error;
    });
    return ready;
  }

  /** The faces in view now: { count }, plus for the largest one its descriptor and width in pixels. */
  async function read(video) {
    const faces = await window.faceapi.detectAllFaces(video, detectorOptions()).withFaceLandmarks().withFaceDescriptors();
    if (!faces.length) return { count: 0 };
    const largest = faces.reduce((a, b) => (b.detection.box.width > a.detection.box.width ? b : a));
    return {
      count: faces.length,
      width: largest.detection.box.width,
      descriptor: Array.from(largest.descriptor, (n) => Number(n.toFixed(6))),
    };
  }

  return { load, read };
})();
