// Imagen de relleno local (SVG embebido): no depende de servicios externos
const ph = (color, text) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#${color}"/><text x="400" y="310" font-family="monospace" font-size="36" fill="#000" fill-opacity=".6" text-anchor="middle">${text}</text></svg>`
);

// Exportamos la matriz principal de proyectos
export const categoryPlanetData = [
  { 
    id: 1, 
    title: { es: 'GameLab Tadeo', en: 'Tadeo GameLab' }, 
    role: { es: 'Director / Lead Researcher', en: 'Director / Lead Researcher' },
    tech: { es: ['Investigación', 'Game Design', 'Gestión Académica', 'WebXR'], en: ['Research', 'Game Design', 'Academic Management', 'WebXR'] },
    desc: { es: 'Nodo de Investigación y Desarrollo Interactivo.', en: 'Interactive Research and Development Node.' }, 
    color: 0xff0055, 
    gallery: ["/imge/chaplin.jpg", "/imge/gamber.png","/imge/zenova.jpg", "/imge/ley_1.jpg"],
    videos: ['https://www.youtube.com/embed/7AU-kRzSwIk?si=_mQ7bBEBZRR0R1vU', "/imge/zonar.mp4","/imge/Asteroide2.mp4"],
    link: 'https://www.instagram.com/gamelabtadeo/',
    longDesc: { 
      es: `<p style="color: #ccc; margin-top: 0;">El <strong>GameLab Tadeo</strong> es un ecosistema donde investigamos cómo las mecánicas de juego pueden transformar realidades: de qué manera unas reglas bien diseñadas cambian lo que una persona entiende, siente y decide.</p><p style="color: #ccc;">Desde la dirección del laboratorio articulo tres frentes: investigación aplicada, formación en diseño de videojuegos y producción de prototipos jugables. El laboratorio funciona como un espacio de cruce entre diseño, arte y ciencia, donde estudiantes, docentes y colaboradores externos trabajan los mismos problemas desde disciplinas distintas.</p><p style="color: #ccc;">Aquí el juego no es un producto final sino un instrumento de pensamiento: se diseña, se prueba con personas y se revisa a la luz de lo que revela. Es la base práctica de mi trabajo doctoral sobre retórica procedimental y «Juegos Otros».</p>`,
      en: `<p style="color: #ccc; margin-top: 0;"><strong>Tadeo GameLab</strong> is an ecosystem where we research how game mechanics can transform realities: how well-designed rules change what a person understands, feels and decides.</p><p style="color: #ccc;">As director of the lab I coordinate three fronts: applied research, game-design education and the production of playable prototypes. The lab works as a crossing point between design, art and science, where students, faculty and outside collaborators tackle the same problems from different disciplines.</p><p style="color: #ccc;">Here a game is not a finished product but an instrument of thought: it is designed, tested with people and revised in light of what it reveals. It is the practical basis of my doctoral work on procedural rhetoric and «Other Games».</p>`
    }
  },
  { 
    id: 2, 
    title: { es: 'Consola Arduino', en: 'Arduino Console' }, 
    role: { es: 'Hardware & Software Developer', en: 'Hardware & Software Developer' },
    tech: { es: ['Arduino', 'C++', 'Impresión 3D', 'Electrónica'], en: ['Arduino', 'C++', '3D Printing', 'Electronics'] },
    desc: { es: 'Mini-consola portátil construida desde cero.', en: 'Portable mini-console built from scratch.' }, 
    color: 0x00aaff, 
    gallery: ['/imge/chaplin.jpg', '/imge/gamelab-2.jpg'], 
    videoSrc: 'https://www.youtube.com/embed/7AU-kRzSwIk?si=_mQ7bBEBZRR0R1vU', 
    link: 'https://www.utadeo.edu.co/es',
    longDesc: { 
      es: `<p style="color: #ccc; margin-top: 0;">Un proyecto doctoral que parte de una pregunta sencilla: ¿qué cambia cuando quien juega también entiende el hardware que lo sostiene? La <strong>Consola Arduino</strong> es una mini-consola portátil construida desde cero, sin cajas negras.</p><p style="color: #ccc;">El desarrollo cubre el circuito, el firmware en C++, la carcasa impresa en 3D y el diseño de los juegos que corren en ella. Cada decisión técnica —la pantalla, los botones, la memoria disponible— se convierte en una restricción de diseño que moldea las mecánicas posibles.</p><p style="color: #ccc;">Trabajar con componentes básicos vuelve visible lo que normalmente se oculta en los dispositivos comerciales, y abre una vía de soberanía tecnológica: poder construir, reparar y reinterpretar las propias herramientas de juego.</p>`,
      en: `<p style="color: #ccc; margin-top: 0;">A doctoral project that starts from a simple question: what changes when the person playing also understands the hardware beneath it? The <strong>Arduino Console</strong> is a portable mini-console built from scratch, with no black boxes.</p><p style="color: #ccc;">The development covers the circuit, the C++ firmware, the 3D-printed shell and the design of the games that run on it. Each technical decision — the screen, the buttons, the available memory — becomes a design constraint that shapes the possible mechanics.</p><p style="color: #ccc;">Working from basic components makes visible what commercial devices usually hide, and opens a path toward technological sovereignty: being able to build, repair and reinterpret one's own play tools.</p>`
    }
  },
  { 
    id: 3, 
    title: { es: 'MediaLab Cinemateca', en: 'Cinemateca MediaLab' }, 
    role: { es: 'Coordinador & Curador', en: 'Coordinator & Curator' },
    tech: { es: ['Gestión Cultural', 'Nuevos Medios', 'Co-creación'], en: ['Cultural Management', 'New Media', 'Co-creation'] },
    desc: { es: 'Coordinador del MediaLab y curaduría MediaExp.', en: 'MediaLab Coordinator and MediaExp curation.' }, 
    color: 0x00ffaa, 
    gallery: [ph('00ffaa', 'MediaLab 1')], 
    videoSrc: '',
    link: 'https://cinematecadebogota.gov.co/',
    longDesc: { 
      es: `<p style="color: #ccc; margin-top: 0;">Desde el <strong>MediaLab Cinemateca</strong> coordino un espacio de experimentación con medios interactivos y artes audiovisuales, y desarrollo la curaduría de <strong>MediaExp</strong>.</p><p style="color: #ccc;">El trabajo combina gestión cultural y creación: convocar a artistas, diseñadores y públicos; montar piezas que se tocan, se recorren o se completan con quien las visita; y documentar los procesos para que lo aprendido quede disponible.</p><p style="color: #ccc;">La co-creación es el principio rector. Más que exhibir obras terminadas, el MediaLab busca que el público participe del proceso, y que los nuevos medios sean un lugar de encuentro y no una vitrina tecnológica.</p>`,
      en: `<p style="color: #ccc; margin-top: 0;">From the <strong>Cinemateca MediaLab</strong> I coordinate a space for experimentation with interactive media and audiovisual arts, and I develop the curation of <strong>MediaExp</strong>.</p><p style="color: #ccc;">The work combines cultural management and creation: calling together artists, designers and audiences; staging pieces that are touched, walked through or completed by whoever visits them; and documenting the processes so that what was learned remains available.</p><p style="color: #ccc;">Co-creation is the guiding principle. Rather than showing finished works, the MediaLab seeks to involve the public in the process, so that new media become a meeting place and not a technology showcase.</p>`
    }
  },
  { 
    id: 4, 
    title: { es: 'Docencia en Diseño', en: 'Design Teaching' }, 
    role: { es: 'Profesor de Planta', en: 'Full-time Professor' },
    tech: { es: ['Pedagogía', 'Arte Interactivo', 'Diseño Crítico'], en: ['Pedagogy', 'Interactive Art', 'Critical Design'] },
    desc: { es: 'Convergencia entre tecnología, arte y diseño.', en: 'Convergence between technology, art, and design.' }, 
    color: 0xffff00, 
    gallery: [ph('ffff00', 'Clase 1')], 
    videoSrc: '',
    link: '',
    longDesc: { 
      es: `<p style="color: #ccc; margin-top: 0;">Como profesor de planta en diseño trabajo en la convergencia entre tecnología, arte y diseño. La <strong>docencia</strong> es el lugar donde las ideas se ponen a prueba con otras personas.</p><p style="color: #ccc;">Mi enfoque busca dar herramientas conceptuales para materializar ideas en el aula: pedagogía activa, arte interactivo y diseño crítico, con proyectos que se construyen, se juegan y se discuten. Los estudiantes pasan de consumir tecnología a preguntarse cómo está hecha y a quién sirve.</p><p style="color: #ccc;">El aula también alimenta la investigación: lo que se descubre diseñando con estudiantes vuelve al laboratorio, y lo que se investiga en el laboratorio vuelve al aula convertido en ejercicios.</p>`,
      en: `<p style="color: #ccc; margin-top: 0;">As a full-time design professor I work at the convergence of technology, art and design. <strong>Teaching</strong> is where ideas are tested with other people.</p><p style="color: #ccc;">My approach aims to give conceptual tools for materialising ideas in the classroom: active pedagogy, interactive art and critical design, with projects that are built, played and discussed. Students move from consuming technology to asking how it is made and whom it serves.</p><p style="color: #ccc;">The classroom also feeds research: what is discovered while designing with students returns to the lab, and what is researched in the lab returns to the classroom as exercises.</p>`
    }
  },
  { 
    id: 5, 
    title: { es: 'Games for Change', en: 'Games for Change' }, 
    role: { es: 'Game Designer', en: 'Game Designer' },
    tech: { es: ['Impacto Social', 'Mecánicas Lúdicas', 'Resolución de Conflictos'], en: ['Social Impact', 'Game Mechanics', 'Conflict Resolution'] },
    desc: { es: 'Videojuegos como herramientas de transformación.', en: 'Video games as tools for transformation.' }, 
    color: 0xff8800, 
    gallery: [ph('ff8800', 'Juego 1')], 
    videoSrc: '',
    link: '',
    longDesc: { 
      es: `<p style="color: #ccc; margin-top: 0;">En <strong>Games for Change</strong> diseño videojuegos como herramientas de transformación social: juegos cuyas reglas, y no solo su tema, buscan producir un efecto en quien juega.</p><p style="color: #ccc;">Analizo cómo ciertas reglas estructuradas fomentan la empatía, la negociación o la resolución de conflictos, y las traduzco en mecánicas concretas: qué puede hacer el jugador, qué le cuesta y qué descubre al hacerlo.</p><p style="color: #ccc;">Esta línea conecta con la retórica procedimental: un juego argumenta a través de lo que permite y lo que impide. Diseñar con esa conciencia es una forma de responsabilidad.</p>`,
      en: `<p style="color: #ccc; margin-top: 0;">In <strong>Games for Change</strong> I design video games as tools for social transformation: games whose rules, and not only their theme, aim to produce an effect on the player.</p><p style="color: #ccc;">I analyse how certain structured rules foster empathy, negotiation or conflict resolution, and translate them into concrete mechanics: what the player can do, what it costs and what is discovered by doing it.</p><p style="color: #ccc;">This line connects with procedural rhetoric: a game argues through what it allows and what it prevents. Designing with that awareness is a form of responsibility.</p>`
    }
  },
  { 
    id: 6, 
    title: { es: 'TouchDesigner & VR', en: 'TouchDesigner & VR' }, 
    role: { es: 'Technical Artist / Prototyper', en: 'Technical Artist / Prototyper' },
    tech: { es: ['TouchDesigner', 'Realidad Virtual', 'Nodos / Paramétrico'], en: ['TouchDesigner', 'Virtual Reality', 'Nodes / Parametric'] },
    desc: { es: 'Exploración en nuevos medios e interactividad.', en: 'Exploration in new media and interactivity.' }, 
    color: 0xaa00ff, 
    gallery: [ph('aa00ff', 'TouchDesigner 1')], 
    videoSrc: '',
    link: '',
    longDesc: { 
      es: `<p style="color: #ccc; margin-top: 0;">En <strong>TouchDesigner &amp; VR</strong> exploro nuevos medios e interactividad desde la mirada del artista técnico y el prototipador.</p><p style="color: #ccc;">TouchDesigner permite pensar en nodos y parámetros: una forma visual o sonora deja de ser una imagen fija y pasa a ser una función que se puede explorar moviendo perillas. Llevado a realidad virtual, ese espacio paramétrico se habita con el cuerpo.</p><p style="color: #ccc;">El prototipado inmersivo me sirve para diluir la frontera entre lo físico y lo digital y para probar rápido ideas de interacción antes de comprometerlas en un desarrollo mayor.</p>`,
      en: `<p style="color: #ccc; margin-top: 0;">In <strong>TouchDesigner &amp; VR</strong> I explore new media and interactivity from the viewpoint of the technical artist and prototyper.</p><p style="color: #ccc;">TouchDesigner invites thinking in nodes and parameters: a visual or sonic form stops being a fixed image and becomes a function that can be explored by turning dials. Taken into virtual reality, that parametric space is inhabited with the body.</p><p style="color: #ccc;">Immersive prototyping helps me blur the boundary between the physical and the digital, and quickly test interaction ideas before committing them to a larger development.</p>`
    }
  },
  { 
    id: 7, 
    isFolder: true, 
    title: { es: 'DIR: /Galería_Archivos', en: 'DIR: /File_Gallery' }, 
    desc: { es: 'Base de datos fotográfica y videográfica.', en: 'Photographic and videographic database.' }, 
    color: 0xffaa00, 
    gallery: [ph('ffaa00', 'Archivo Foto 1'), ph('cc8800', 'Archivo Foto 2'), ph('aa6600', 'Archivo Foto 3')], 
    videoSrc: '',
    link: '',
    longDesc: { 
      es: `<p style="color: #ccc; margin-top: 0;">Directorio de assets, prototipos fallidos y experimentaciones visuales descartadas a lo largo de los años.</p><p style="color: #ccc;">Es la memoria del taller: fotografías, grabaciones y capturas de procesos que no llegaron a producto, pero que explican cómo se llegó a lo que sí existe. Conservar lo que falló es parte del método.</p><p style="color: #ccc;">Explóralo como un archivo vivo: cada imagen es una huella de una prueba, una duda o un camino que se abandonó.</p>`,
      en: `<p style="color: #ccc; margin-top: 0;">Directory of assets, failed prototypes and visual experiments discarded over the years.</p><p style="color: #ccc;">It is the workshop's memory: photographs, recordings and captures of processes that never became a product but explain how what does exist was reached. Keeping what failed is part of the method.</p><p style="color: #ccc;">Explore it as a living archive: every image is a trace of a test, a doubt or a path that was abandoned.</p>`
    }
  },
  { 
    id: 8, 
    title: { es: 'Módulo WebAR', en: 'WebAR Module' }, 
    desc: { es: 'Integración de Realidad Aumentada Funcional.', en: 'Integration of Functional Augmented Reality.' }, 
    color: 0xff00ff, 
    gallery: [ph('ff00ff', 'WebAR 1'), ph('cc00cc', 'WebAR 2')], 
    videoSrc: '',
    link: '',
    longDesc: { 
      es: `<p style="color: #ccc; margin-top: 0;">Proyectos que anclan geometrías digitales en el mundo real usando estándares abiertos de la web: <strong>WebXR</strong> y <strong>Three.js</strong>, sin instalar aplicaciones.</p><p style="color: #ccc;">El módulo explora qué significa colocar un objeto digital en un lugar concreto y quedarse con él: anclar, esperar, volver. Funciona desde el navegador del teléfono, lo que lo hace accesible para quien visita sin pasos previos.</p><p style="color: #ccc;">Apostar por estándares abiertos es también una postura: el conocimiento técnico queda al alcance de quien quiera aprender, replicar o transformar la obra.</p>`,
      en: `<p style="color: #ccc; margin-top: 0;">Projects that anchor digital geometry in the real world using open web standards: <strong>WebXR</strong> and <strong>Three.js</strong>, with no app to install.</p><p style="color: #ccc;">The module explores what it means to place a digital object in a specific place and stay with it: anchoring, waiting, coming back. It runs from the phone's browser, making it accessible to visitors with no prior steps.</p><p style="color: #ccc;">Betting on open standards is also a stance: the technical knowledge remains within reach of anyone who wants to learn, replicate or transform the work.</p>`
    }
  }
];

export const whaleData = { 
  id: 98, 
  title: { es: 'LOG_WHL // BESTIARIO', en: 'LOG_WHL // BESTIARY' }, 
  desc: { es: 'Entidad "Ballena Cósmica". Un cúmulo residual de datos masivos que navega por la caché profunda.', en: 'Entity "Cosmic Whale". A residual cluster of massive data navigating the deep cache.' }, 
  longDesc: { es: 'Nuestros escáneres indican que esta entidad pacífica limpia archivos corruptos a su paso. Es un remanente de una versión antigua del sistema operativo.', en: 'Scanners indicate this peaceful entity cleans corrupt files in its wake. It is a remnant of an older OS version.' }, 
  mediaType: 'image', 
  mediaSrc: 'https://images.unsplash.com/photo-1614729939124-032f0b56c9ce?w=600&q=80', 
  link: '', 
  originalColor: 0xffffff 
};