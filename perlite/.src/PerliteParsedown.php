<?php

/*!
 * Perlite v1.6.1 (https://github.com/secure-77/Perlite)
 * Author: sec77 (https://secure77.de)
 * Licensed under MIT (https://github.com/secure-77/Perlite/blob/main/LICENSE)
 */

namespace Perlite;

use Parsedown;

class PerliteParsedown extends Parsedown
{



    protected $path;
    protected $uriPath;
    protected $niceLinks;
    protected $allowedFileLinkTypes;
    protected $allowedImageTypes;

    # footnotes: id => raw text, and id => number in order of first reference
    protected $footnoteDefinitions = array();
    protected $footnoteNumbers = array();
    protected $footnoteRefCounts = array();

    # note embeds: the note being rendered (vault path, e.g. "/Folder/Note")
    # and the chain of embeds being rendered (cycle / depth protection)
    public $currentNote = null;
    protected static $embedStack = array();

    protected $inlineMarkerList = '!"*$_#&[:<>`~\\=%';

    protected $InlineTypes = array(
        '"' => array('SpecialCharacter'),
        '!' => array('Image', 'InternalEmbed'),
        '&' => array('SpecialCharacter'),
        '*' => array('Emphasis'),
        ':' => array('Url'),
        '<' => array('UrlTag', 'EmailTag', 'Markup', 'SpecialCharacter'),
        '>' => array('SpecialCharacter'),
        '[' => array('FootnoteMarker', 'Link', 'InternalMarkdownLink', 'InternalLink'),
        '#' => array('Tag'),
        '$' => array('Katex'),
        '_' => array('Emphasis'),
        '`' => array('Code'),
        '~' => array('Strikethrough'),
        '\\' => array('EscapeSequence'),
        '=' => array('Highlight'),
        '%' => array('Hidden'),
    );


    public function __construct(
        $path = '',
        $uriPath = '/',
        $niceLinks = false,
        array $allowedFileLinkTypes = array('mp4', 'm4a', 'pdf'),
        array $allowedImageTypes = array(
            'png',
            'jpg',
            'jpeg',
            'svg',
            'gif',
            'bmp',
            'tif',
            'tiff',
            'webp'
        )
    ) {

        $this->path = $path;
        $this->uriPath = $uriPath;
        $this->niceLinks = $niceLinks;
        $this->allowedFileLinkTypes = $allowedFileLinkTypes;
        $this->allowedImageTypes = $allowedImageTypes;

        $this->BlockTypes['!'] = array('NoteEmbed', 'YouTube');

    }

    function text($text)
    {
        # make sure no definitions are set
        $this->DefinitionData = array();

        # standardize line breaks
        $text = str_replace(array("\r\n", "\r"), "\n", $text);

        # remove surrounding line breaks
        $text = trim($text, "\n");

        # split text into lines
        $lines = explode("\n", $text);

        # YAML front matter
        $parsedYamlBlockText = "";
        if ($lines[0] === '---') {

            # search ending
            $yamlBlockArray = array_slice($lines, 1, count($lines));
            $endIndex = 0;
            foreach ($yamlBlockArray as $line) {
                $endIndex += 1;
                if ($line === '---') {
                    break;
                }
            }
            $yamlBlockArray = array_slice($lines, 0, $endIndex);
            $yamlBlockText = implode("\n", $yamlBlockArray);
            $lines = array_slice($lines, $endIndex + 1, count($lines));
            $parsedYamlBlockText = $this->yamlFrontmatter($yamlBlockText);
        }

        # footnotes: pull out [^id]: definitions before block parsing
        $lines = $this->extractFootnoteDefinitions($lines);

        # iterate through lines to identify blocks
        $markup = $this->lines($lines);

        # append the footnotes list
        $markup .= $this->buildFootnotesSection();

        # cssclasses from front matter -> applied to the page by perlite.js
        if (isset($yamlBlockText)) {
            $cssClasses = $this->frontmatterCssClasses($yamlBlockText);
            if ($cssClasses !== '') {
                $markup = '<div class="perlite-cssclasses" style="display:none" data-cssclasses="'
                    . self::escape($cssClasses) . '"></div>' . $markup;
            }
        }

        # add front matter
        $markup = $parsedYamlBlockText . $markup;
        # trim line breaks
        $markup = trim($markup, "\n");

        return $markup;
    }

    protected function yamlFrontmatter(string $yaml): string
    {
        $parsed = $this->parseSimpleYaml($yaml);

        $yamlText = '
    <div class="mod-header">
        <div class="metadata-properties-heading">
            <div class="collapse-indicator collapse-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon right-triangle">
                    <path d="M3 8L12 17L21 8"></path>
                </svg>
            </div>
            <div class="metadata-properties-title">Properties</div>
        </div>
        <div class="metadata-container mod-error" tabindex="-1" data-property-count="1">
            <div class="metadata-content">
                <div class="metadata-properties">
    ';

        // Aliases
        if (isset($parsed['aliases']) && is_array($parsed['aliases'])) {
            $yamlText .= '
        <div class="metadata-property" tabindex="0" data-property-key="aliases" data-property-type="multitext">
            <div class="metadata-property-key">
                <span class="metadata-property-icon" aria-disabled="false">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-forward">
                        <polyline points="15 17 20 12 15 7"/>
                        <path d="M4 18v-2a4 4 0 0 1 4-4h12"/>
                    </svg>
                </span>
                <span class="metadata-text">aliases</span>
            </div>
            <div class="metadata-property-value">
                <div class="multi-select-container">
        ';

            foreach ($parsed['aliases'] as $alias) {
                $yamlText .= '<div class="multi-select-pill multi-select-pill-content">'
                    . htmlspecialchars($alias, ENT_QUOTES, 'UTF-8')
                    . '</div>';
            }

            $yamlText .= '</div></div></div>';
        }

        // Tags
        if (isset($parsed['tags']) && is_array($parsed['tags'])) {
            $yamlText .= '
        <div class="metadata-property" tabindex="0" data-property-key="tags" data-property-type="multitext">
            <div class="metadata-property-key">
                <span class="metadata-property-icon" aria-disabled="false">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-tags">
                        <path d="M9 5H2v7l6.29 6.29c.94.94 2.48.94 3.42 0l3.58-3.58c.94-.94.94-2.48 0-3.42L9 5Z"/>
                        <path d="M6 9.01V9"/>
                        <path d="m15 5 6.3 6.3a2.4 2.4 0 0 1 0 3.4L17 19"/>
                    </svg>
                </span>
                <span class="metadata-text">tags</span>
            </div>
            <div class="metadata-property-value">
                <div class="multi-select-container">
        ';

            foreach ($parsed['tags'] as $tag) {
                $Block = [
                    'element' => [
                        'name' => 'div',
                        'text' => '#' . $tag,
                        'attributes' => [
                            'class' => 'multi-select-pill multi-select-pill-content'
                        ],
                        'handler' => 'line',
                    ],
                ];

                $yamlText .= $this->elements($Block);
            }

            $yamlText .= '</div></div></div>';
        }

        $yamlText .= '</div></div></div></div></div>';

        return $yamlText;
    }

    protected function parseSimpleYaml(string $yaml): array
    {
        $lines = preg_split('/\R/', $yaml);
        $data = [];
        $currentKey = null;

        foreach ($lines as $line) {
            $line = rtrim($line);

            // Skip empty lines and comments
            if ($line === '' || str_starts_with(trim($line), '#')) {
                continue;
            }

            // Key: value
            if (preg_match('/^([A-Za-z0-9_-]+):\s*(.*)$/', $line, $matches)) {
                $currentKey = $matches[1];
                $value = $matches[2];

                if ($value === '') {
                    $data[$currentKey] = [];
                } else {
                    $data[$currentKey] = $this->castYamlValue($value);
                    $currentKey = null;
                }

                continue;
            }

            // List item
            if ($currentKey !== null && preg_match('/^\s*-\s*(.+)$/', $line, $matches)) {
                $data[$currentKey][] = $this->castYamlValue($matches[1]);
            }
        }

        return $data;
    }

    protected function castYamlValue(string $value): mixed
    {
        $value = trim($value, " \t\n\r\0\x0B\"'");

        return match (strtolower($value)) {
            'true' => true,
            'false' => false,
            'null' => null,
            default => is_numeric($value)
            ? ($value + 0)
            : $value,
        };
    }


    #
    # Callout (based on blockQuotes)
    # See: https://help.obsidian.md/How+to/Use+callouts


    # Callout Block
    protected function blockQuote($Line)
    {


        if (preg_match('/^>[ ]?(.*)/', $Line['text'], $matches)) {
            $Block = array(
                'element' => array(
                    'name' => 'blockquote',
                    'handler' => 'lines',
                    'text' => (array) $matches[1],
                ),
            );


            if (preg_match('/^>\s?\[\!(.*?)\](.*?)$/m', $Line['text'], $matches)) {
                # Obsidian syntax: [!type|meta1 meta2]  ->  type + data-callout-metadata
                # (needed for ITS-style callouts like [!cards|3], [!infobox|left], ...)
                $calloutParts = explode('|', $matches[1], 2);
                $type = strtolower(trim($calloutParts[0]));
                $metadata = isset($calloutParts[1]) ? trim($calloutParts[1]) : '';
                $title = trim($matches[2]);

                $calloutTitle = $title ?: ucfirst($type);

                # Handle collapsible callouts
                $calloutclass = 'callout';
                $calloutStyle = 'unset';
                $collapsibleIcon = array(
                    'name' => 'div',
                    'text' => ''
                );
                $isCollapsed = '';
                $needCollapseIcon = False;
                $isCollapsedIcon = '';
                $calloutTitleClass = 'callout-title-inner';

                if (substr($calloutTitle, 0, 1) == '+') {
                    $calloutTitle = substr($calloutTitle, 1);
                    $calloutclass = 'callout is-collapsible';
                    $calloutTitleClass = 'callout-title-inner is-collapsible';
                    $calloutStyle = 'unset';
                    $needCollapseIcon = True;
                }

                if (substr($calloutTitle, 0, 1) == '-') {
                    $calloutTitle = substr($calloutTitle, 1);
                    $calloutclass = 'callout is-collapsible is-collapsed';
                    $calloutStyle = 'none';
                    $isCollapsed = 'is-collapsed-callout';
                    $isCollapsedIcon = 'is-collapsed';
                    $calloutTitleClass = 'callout-title-inner is-collapsed';
                    $needCollapseIcon = True;
                }

                if ($needCollapseIcon) {
                    $collapsibleIcon = array(
                        'name' => 'div',
                        'attributes' => array('class' => 'callout-fold ' . $isCollapsedIcon),
                        'elements' => array(
                            # svg
                            array(
                                'name' => 'svg',
                                'attributes' => array(
                                    'xmlns' => 'http://www.w3.org/2000/svg',
                                    'width' => '24',
                                    'height' => '24',
                                    'viewBox' => '0 0 24 24',
                                    'fill' => 'none',
                                    'stroke' => 'currentColor',
                                    'stroke-width' => '2',
                                    'stroke-linecap' => 'round',
                                    'stroke-linejoin' => 'round',
                                    'class' => 'svg-icon lucide-chevron-down',
                                ),
                                # pathes and lines
                                'elements' => array(array('name' => '<path d="m6 9 6 6 6-6"/>')),
                            ),
                        ),
                    );
                }



                $Block = array(
                    'element' => array(
                        'name' => 'div',
                        'attributes' => array(
                            'data-callout' => $type,
                            'data-callout-metadata' => $metadata,
                            'class' => $calloutclass
                        ),
                        'elements' => array(
                            array(
                                'name' => 'div',
                                'attributes' => array('class' => 'callout-title'),
                                'elements' => array(
                                    # callout icon
                                    array(
                                        'name' => 'div',
                                        'attributes' => array('class' => 'callout-icon'),
                                        'elements' => array(
                                            # svg
                                            array(
                                                'name' => 'svg',
                                                'attributes' => array(
                                                    'xmlns' => 'http://www.w3.org/2000/svg',
                                                    'width' => '24',
                                                    'height' => '24',
                                                    'viewBox' => '0 0 24 24',
                                                    'fill' => 'none',
                                                    'stroke' => 'currentColor',
                                                    'stroke-width' => '2',
                                                    'stroke-linecap' => 'round',
                                                    'stroke-linejoin' => 'round',
                                                    'class' => $this->getCalloutIcon($type)[0],
                                                ),
                                                # pathes and lines
                                                'elements' => $this->getCalloutIcon($type)[1]
                                            ),
                                        ),
                                    ),
                                    # callout title
                                    array(
                                        'name' => 'div',
                                        'attributes' => array('class' => $calloutTitleClass),
                                        # inline like Obsidian (no <p> inside the title)
                                        'text' => trim($calloutTitle),
                                        'handler' => 'line',

                                    ),
                                    # collapsible icon
                                    $collapsibleIcon,
                                ),
                            ),
                            # callout content
                            array(
                                'name' => 'div',
                                'attributes' => array(
                                    'class' => 'callout-content ' . $isCollapsed,
                                ),
                                'handler' => 'lines',
                            ),


                        )
                    ),
                );
            }
        }


        return $Block;
    }

    # Callout Icons
    protected function getCalloutIcon($callType)
    {
        // default = info
        $class = 'svg-icon lucide-pencil';
        $pathes = array(
            array('name' => 'line x1="18" y1="2" x2="22" y2="6"'),
            array('name' => 'path d="M7.5 20.5 19 9l-4-4L3.5 16.5 2 22z"')
        );

        $callType = strtolower($callType);
        switch ($callType) {

            case 'abstract':
                $class = 'svg-icon lucide-clipboard-list';
                $pathes = array(
                    array('name' => 'rect x="8" y="2" width="8" height="4" rx="1" ry="1"'),
                    array('name' => 'path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"'),
                    array('name' => 'path d="M12 11h4"'),
                    array('name' => 'path d="M12 16h4"'),
                    array('name' => 'path d="M8 11h.01"'),
                    array('name' => 'path d="M8 16h.01"'),
                );
                break;
            case 'info':
                $class = 'svg-icon lucide-info';
                $pathes = array(
                    array('name' => 'circle cx="12" cy="12" r="10"'),
                    array('name' => 'line x1="12" y1="16" x2="12" y2="12"'),
                    array('name' => 'line x1="12" y1="8" x2="12.01" y2="8"'),
                );
                break;
            case 'todo':
                $class = 'svg-icon lucide-check-circle-2';
                $pathes = array(
                    array('name' => 'path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"'),
                    array('name' => 'path d="m9 12 2 2 4-4"'),
                );
                break;
            case 'tip':
                $class = 'svg-icon lucide-flame';
                $pathes = array(
                    array('name' => 'path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"'),
                );
                break;
            case 'success':
                $class = 'svg-icon lucide-check';
                $pathes = array(
                    array('name' => 'polyline points="20 6 9 17 4 12"'),
                );
                break;
            case 'question':
                $class = 'svg-icon lucide-help-circle';
                $pathes = array(
                    array('name' => 'circle cx="12" cy="12" r="10"'),
                    array('name' => 'path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"'),
                    array('name' => 'line x1="12" y1="17" x2="12.01" y2="17"'),
                );
                break;
            case 'warning':
                $class = 'svg-icon lucide-alert-triangle';
                $pathes = array(
                    array('name' => 'path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"'),
                    array('name' => 'line x1="12" y1="9" x2="12" y2="13"'),
                    array('name' => 'line x1="12" y1="17" x2="12.01" y2="17"'),
                );
                break;
            case 'failure':
                $class = 'svg-icon lucide-x';
                $pathes = array(
                    array('name' => 'line x1="18" y1="6" x2="6" y2="18"'),
                    array('name' => 'line x1="6" y1="6" x2="18" y2="18"'),
                );
                break;
            case 'danger':
                $class = 'svg-icon lucide-zap';
                $pathes = array(
                    array('name' => 'polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"'),
                );
                break;
            case 'bug':
                $class = 'svg-icon lucide-bug';
                $pathes = array(
                    array('name' => 'rect x="8" y="6" width="8" height="14" rx="4"'),
                    array('name' => 'path d="m19 7-3 2"'),
                    array('name' => 'path d="m5 7 3 2"'),
                    array('name' => 'path d="m19 19-3-2"'),
                    array('name' => 'path d="m5 19 3-2"'),
                    array('name' => 'path d="M20 13h-4"'),
                    array('name' => 'path d="M4 13h4"'),
                    array('name' => 'path d="m10 4 1 2"'),
                    array('name' => 'path d="m14 4-1 2"'),
                );
                break;
            case 'example':
                $class = 'svg-icon lucide-list';
                $pathes = array(
                    array('name' => 'line x1="8" y1="6" x2="21" y2="6"'),
                    array('name' => 'line x1="8" y1="12" x2="21" y2="12"'),
                    array('name' => 'line x1="8" y1="18" x2="21" y2="18"'),
                    array('name' => 'line x1="3" y1="6" x2="3.01" y2="6"'),
                    array('name' => 'line x1="3" y1="12" x2="3.01" y2="12"'),
                    array('name' => 'line x1="3" y1="18" x2="3.01" y2="18"'),
                );
                break;
            case 'quote':
                $class = 'svg-icon lucide-quote';
                $pathes = array(
                    array('name' => 'path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"'),
                    array('name' => 'path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"'),
                );
                break;
        }

        return array($class, $pathes);
    }

    # Callout Block inner
    protected function blockQuoteContinue($Line, array $Block)
    {

        if ($Line['text'][0] === '>' and preg_match('/^>[ ]?(.*)/', $Line['text'], $matches)) {

            if (isset($Block['interrupted'])) {

                unset($Block['interrupted']);
            }


            $quoteContent = $matches[1];

            if (isset($Block['element']['elements'])) {
                $Block['element']['elements'][1]['text'][] = $quoteContent;
            } else {
                $Block['element']['text'][] = $quoteContent;
            }


            return $Block;
        }


        if (!isset($Block['interrupted'])) {

            if (isset($Block['element']['elements'])) {
                $Block['element']['elements'][1]['text'][] = $Line['text'];
            } else {
                $Block['element']['text'][] = $Line['text'];
            }

            return $Block;
        }
    }

    # blockHeader seperated from Tags
    protected function blockHeader($Line)
    {
        if (isset($Line['text'][1]) && ($Line['text'][1] === ' ' || $Line['text'][1] === '#')) {
            $level = 1;

            while (isset($Line['text'][$level]) and $Line['text'][$level] === '#') {
                $level++;
            }

            if ($level > 6) {
                return;
            }

            $text = trim($Line['text'], '# ');

            $Block = array(
                'element' => array(
                    'name' => 'h' . min(6, $level),
                    'text' => $text,
                    'handler' => 'line',
                ),
            );

            return $Block;
        }
    }

    protected function blockYouTube($Line)
    {

        if (!isset($Line['text'][1]) or $Line['text'][1] !== '[') {
            return;
        }

        $Line['text'] = substr($Line['text'], 1);

        $Link = $this->inlineLink($Line);


        if ($Link === null) {
            return;
        }

        // See: https://stackoverflow.com/a/64320469
        $yt = preg_match('%(?:youtube(?:-nocookie)?\.com/(?:[^/]+/.+/|(?:v|e(?:mbed)?)/|.*[?&]v=)|youtu\.be/)([^"&?/ ]{11})%i', $Link['element']['attributes']['href'], $match);

        if (!$yt) {
            return;
        }

        $youtubeId = $match[1];
        $Block = array(
            'element' => array(
                'name' => 'iframe',
                'text' => $Line['text'],
                'handler' => 'line',

                'attributes' => array(
                    'class' => 'external-embed mod-receives-events',
                    'sandbox' => 'allow-forms allow-presentation allow-same-origin allow-scripts allow-modals allow-popups',
                    'allow' => 'fullscreen',
                    'frameborder' => '0',
                    'src' => 'https://www.youtube.com/embed/' . $youtubeId,
                ),

            ),
        );

        return $Block;
    }


    # handle highlight code
    protected function inlineHighlight($Excerpt)
    {
        $marker = $Excerpt['text'][1];

        if (preg_match('/^==(.+?)==/s', $Excerpt['text'], $matches)) {
            $content = $matches[1];
            $Inline = array(
                'extent' => strlen($matches[0]),
                'element' => array(
                    'name' => 'span',
                    'text' => $content,
                    'attributes' => array(
                        'class' => 'cm-highlight'
                    ),
                ),
            );

            return $Inline;
        }
    }

    # handle hidden code
    protected function inlineHidden($Excerpt)
    {
        $marker = $Excerpt['text'][1];

        if (preg_match('/^%%(.+?)%%/s', $Excerpt['text'], $matches)) {
            $content = "";
            $Inline = array(
                'extent' => strlen($matches[0]),
                'element' => array(
                    'name' => 'span',
                    'text' => $content,
                ),
            );

            return $Inline;
        }

    }

    # handle katex code
    protected function inlineKatex($Excerpt)
    {
        $marker = $Excerpt['text'][0];
        if (preg_match('/^(\\' . $marker . '+)[ ]*(.+?)[ ]*(?<!\\' . $marker . ')\1(?!\\' . $marker . ')/s', $Excerpt['text'], $matches)) {
            $text = $matches[0];
            $text = preg_replace("/[ ]*\n/", ' ', $text);

            $name = 'katex';
            if ($matches[1] === '$') {
                $name = 'katex-inline';
            }
            return array(
                'extent' => strlen($matches[0]),
                'element' => array(
                    'name' => $name,
                    'text' => $text,
                ),
            );
        }
    }

    # handle obsidian tags
    protected function inlineTag($Excerpt)
    {
        if (!isset($Excerpt['text'][1]) or $Excerpt['text'][0] !== '#') {
            return;
        }

        # ignore tags in links
        $len = strlen($Excerpt['context']);
        if ($len == 0) {
            return;
        }
        if (substr(trim($Excerpt['context']), -1) === ']') {
            return;
        }

        if (preg_match("/(^| )#[\w'-\/]+/ui", $Excerpt['context'], $matches, PREG_OFFSET_CAPTURE)) {
            $tag = $matches[0][0];

            $Inline = array(
                'extent' => strlen($matches[0][0]),
                'position' => $matches[0][1],
                'element' => array(
                    'name' => 'a',
                    'text' => $tag,
                    'attributes' => array(
                        'href' => $tag,
                        'class' => 'tag'
                    ),
                ),
            );

            return $Inline;
        }
    }

    protected function blockList($Line)
    {
        list($name, $pattern) = $Line['text'][0] <= '-' ? array('ul', '[*+-]') : array('ol', '[0-9]+[.]');



        if (preg_match('/^(' . $pattern . '[ ]+)(.*)/', $Line['text'], $matches)) {
            $Block = array(
                'indent' => $Line['indent'],
                'pattern' => $pattern,
                'element' => array(
                    'name' => $name,
                    'handler' => 'elements',
                ),
            );

            if ($name === 'ol') {
                $listStart = stristr($matches[0], '.', true);

                if ($listStart !== '1') {
                    $Block['element']['attributes'] = array('start' => $listStart);
                }
            }

            $Block['li'] = array(
                'name' => 'li',
                'handler' => 'li',
                'text' => array(
                    $matches[2],
                ),
            );

            $this->markTaskItem($Block);

            $Block['element']['text'][] = &$Block['li'];

            return $Block;
        }
    }

    # Task lists, rendered like Obsidian's reading view so themes/snippets work:
    #   <ul class="contains-task-list">
    #     <li class="task-list-item is-checked" data-task="?">
    #       <input type="checkbox" class="task-list-item-checkbox" data-task="?" checked>text
    # Any character in [ ] is supported (alternate checkboxes: [?] [!] [-] [/] ...).
    protected function markTaskItem(array &$Block)
    {
        $first = $Block['li']['text'][0] ?? '';
        if (!preg_match('/^\[(.)\](?:[ \t]|$)/u', $first, $m)) {
            return;
        }
        $task = $m[1] === ' ' ? '' : $m[1];
        $Block['li']['attributes'] = array(
            'class' => 'task-list-item' . ($task !== '' ? ' is-checked' : ''),
            'data-task' => $task,
        );
        $Block['element']['attributes']['class'] = 'contains-task-list';
    }

    protected function li($lines)
    {
        $checkbox = '';
        if (isset($lines[0]) && preg_match('/^\[(.)\](?:[ \t]+|$)/u', $lines[0], $m)) {
            $task = $m[1] === ' ' ? '' : $m[1];
            $checkbox = '<input type="checkbox" class="task-list-item-checkbox" data-task="'
                . self::escape($task) . '"' . ($task !== '' ? ' checked' : '') . '>';
            $lines[0] = substr($lines[0], strlen($m[0]));
        }

        return $checkbox . parent::li($lines);
    }

    protected function blockListContinue($Line, array $Block)
    {


        $Block['indent'] = isset($Block['indent']) ? $Block['indent'] : '0';

        if ($Block['indent'] === $Line['indent'] and preg_match('/^' . $Block['pattern'] . '(?:[ ]+(.*)|$)/', $Line['text'], $matches)) {

            if (isset($Block['interrupted'])) {
                $Block['li']['text'][] = '';

                $Block['loose'] = true;

                unset($Block['interrupted']);
            }

            unset($Block['li']);

            $text = isset($matches[1]) ? $matches[1] : '';

            $Block['li'] = array(
                'name' => 'li',
                'handler' => 'li',
                'text' => array(
                    $text,
                ),
            );

            $this->markTaskItem($Block);

            $Block['element']['text'][] = &$Block['li'];

            return $Block;
        }

        if ($Line['text'][0] === '[' and $this->blockReference($Line)) {
            return $Block;
        }

        if (!isset($Block['interrupted'])) {
            if (preg_match('/^[`~]{3,}/', $Line['text'])) {
                return null;
            }
            $text = preg_replace('/^[ ]{0,4}/', '', $Line['body']);

            $Block['li']['text'][] = $text;

            return $Block;
        }

        if ($Line['indent'] > 0) {
            $Block['li']['text'][] = '';

            $text = preg_replace('/^[ ]{0,4}/', '', $Line['body']);

            $Block['li']['text'][] = $text;

            unset($Block['interrupted']);

            return $Block;
        }
    }

    # handle external Urls
    protected function inlineUrl($Excerpt)
    {
        if ($this->urlsLinked !== true or !isset($Excerpt['text'][2]) or $Excerpt['text'][2] !== '/') {
            return;
        }

        if (preg_match('/\bhttps?:[\/]{2}[^\s<]+\b\/*/ui', $Excerpt['context'], $matches, PREG_OFFSET_CAPTURE)) {
            $url = $matches[0][0];

            $Inline = array(
                'extent' => strlen($matches[0][0]),
                'position' => $matches[0][1],
                'element' => array(
                    'name' => 'a',
                    'text' => $url,
                    'attributes' => array(
                        'href' => $url,
                        'class' => 'external-link perlite-external-link',
                        'target' => '_blank',
                        'rel' => 'noopener noreferrer',
                    ),
                ),
            );

            return $Inline;
        }
    }

    # handle external obsidian Urls
    protected function inlineLink($Excerpt)
    {
        $Element = array(
            'name' => 'a',
            'handler' => 'line',
            'nonNestables' => array('Url', 'Link'),
            'text' => null,
            'attributes' => array(
                'href' => null,
                'title' => null,
                'class' => 'external-link perlite-external-link',
                'target' => '_blank',
                'rel' => 'noopener noreferrer',
            ),
        );

        $extent = 0;

        $remainder = $Excerpt['text'];

        if (preg_match('/\[((?:[^][]++|(?R))*+)\]/', $remainder, $matches)) {
            $Element['text'] = $matches[1];

            $extent += strlen($matches[0]);

            $remainder = substr($remainder, $extent);
        } else {
            return;
        }

        if (preg_match('/^[(]\s*+((?:[^ ()]++|[(][^ )]+[)])++)(?:[ ]+("[^"]*"|\'[^\']*\'))?\s*[)]/', $remainder, $matches)) {
            $Element['attributes']['href'] = $matches[1];

            if (isset($matches[2])) {
                $Element['attributes']['title'] = substr($matches[2], 1, -1);
            }

            $extent += strlen($matches[0]);
        } else {
            if (preg_match('/^\s*\[(.*?)\]/', $remainder, $matches)) {
                $definition = strlen($matches[1]) ? $matches[1] : $Element['text'];
                $definition = strtolower($definition);

                $extent += strlen($matches[0]);
            } else {
                $definition = strtolower($Element['text']);
            }

            if (!isset($this->DefinitionData['Reference'][$definition])) {
                return;
            }

            $Definition = $this->DefinitionData['Reference'][$definition];

            $Element['attributes']['href'] = $Definition['url'];
            $Element['attributes']['title'] = $Definition['title'];
        }

        # Markdown links to notes, e.g. [text](Folder/My%20Note.md) or
        # [![[image.png]]](Note.md#Heading), are internal links like in Obsidian:
        # same URL, class and tab as a [[wikilink]]. The link text is still parsed
        # normally, so an image inside the link keeps working.
        $internal = $this->markdownLinkToInternal((string) $Element['attributes']['href']);
        if ($internal !== null) {
            $Element['attributes']['href'] = $internal['href'];
            $Element['attributes']['class'] = $internal['class'];
            $Element['attributes']['target'] = null;
            $Element['attributes']['rel'] = null;
        }

        return array(
            'extent' => $extent,
            'element' => $Element,
        );
    }

    # Returns the internal link attributes for a markdown link target that points
    # at a note, or null for URLs, same-page anchors and links to files.
    protected function markdownLinkToInternal(string $href)
    {
        $href = trim($href);
        if ($href === '' || $href[0] === '#' || str_starts_with($href, '//')
            || preg_match('/^[a-z][a-z0-9+.-]*:/i', $href)) {
            return null;
        }

        $target = rawurldecode($href);
        $hashPos = strpos($target, '#');
        $file = $hashPos === false ? $target : substr($target, 0, $hashPos);
        $anchor = $hashPos === false ? '' : substr($target, $hashPos);

        # notes only: ".md" or no extension. Links to files (pdf, images, ...)
        # stay as they are. A numeric "extension" is part of a note name ("v1.5").
        $ext = pathinfo($file, PATHINFO_EXTENSION);
        if (strtolower($ext) === 'md') {
            $file = substr($file, 0, -3);
        } elseif ($ext !== '' && preg_match('/[a-z]/i', $ext)) {
            return null;
        }
        if (trim($file) === '' || str_contains($file, ']') || str_contains($file, '|')) {
            return null;
        }

        # build it exactly like a [[wikilink]] so both behave the same
        $link = $this->inlineInternalLink(array('text' => '[[' . $file . $anchor . ']]'));
        if ($link === null) {
            return null;
        }

        return array(
            'href' => $link['element']['attributes']['href'],
            'class' => $link['element']['attributes']['class'],
        );
    }

    # adjusted to support nested elements
    protected function element(array $Element)
    {
        if ($this->safeMode) {
            $Element = $this->sanitiseElement($Element);
        }

        $markup = '<' . $Element['name'];

        if (isset($Element['attributes'])) {
            foreach ($Element['attributes'] as $name => $value) {
                if ($value === null) {
                    continue;
                }

                $markup .= ' ' . $name . '="' . self::escape($value) . '"';
            }
        }

        $permitRawHtml = false;

        # nested element handling
        $closing = false;
        if (isset($Element['elements'])) {
            $markup .= '>';
            $markup .= $this->elements($Element['elements']);
            $closing = true;
        } elseif (isset($Element['text'])) {
            $text = $Element['text'];
        } elseif (isset($Element['rawHtml'])) {
            $text = $Element['rawHtml'];
            $allowRawHtmlInSafeMode = isset($Element['allowRawHtmlInSafeMode']) && $Element['allowRawHtmlInSafeMode'];
            $permitRawHtml = !$this->safeMode || $allowRawHtmlInSafeMode;
        }

        if (isset($text)) {
            $markup .= '>';

            if (!isset($Element['nonNestables'])) {
                $Element['nonNestables'] = array();
            }

            if (isset($Element['handler'])) {
                $markup .= $this->{$Element['handler']}($text, $Element['nonNestables']);
            } elseif (!$permitRawHtml) {
                $markup .= self::escape($text, true);
            } else {
                $markup .= $text;
            }

            $markup .= '</' . $Element['name'] . '>';
        } elseif ($closing) {
            $markup .= '</' . $Element['name'] . '>';
        } elseif (in_array(strtolower($Element['name']), array('area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'), true)) {
            $markup .= ' />';
        } else {
            # "<div />" is not self-closing in HTML: the browser would leave the
            # div open and swallow everything after it (e.g. a title-only callout)
            $markup .= '></' . $Element['name'] . '>';
        }

        return $markup;
    }

    # adjusted to handle interuppted quote blocks
    protected function lines(array $lines)
    {
        $CurrentBlock = null;

        foreach ($lines as $line) {
            if (chop($line) === '') {
                if (isset($CurrentBlock)) {
                    $CurrentBlock['interrupted'] = true;
                }

                continue;
            }

            if (strpos($line, "\t") !== false) {
                $parts = explode("\t", $line);

                $line = $parts[0];

                unset($parts[0]);

                foreach ($parts as $part) {


                    $shortage = 0;
                    if (function_exists('mb_strlen')) {
                        $shortage = 4 - (mb_strlen($input ?? '', 'UTF-8') % 4);
                    } elseif (function_exists('iconv')) {
                        $converted = @iconv('UTF-8', 'ISO-8859-1//TRANSLIT//IGNORE', $input);
                        $shortage = 4 - (strlen($converted) % 4);
                    } else {
                        // Fallback: count bytes (not characters)
                        $shortage = 4 - (strlen($input) % 4);
                    }

                    $line .= str_repeat(' ', $shortage);
                    $line .= $part;
                }
            }

            $indent = 0;

            while (isset($line[$indent]) and $line[$indent] === ' ') {
                $indent++;
            }

            $text = $indent > 0 ? substr($line, $indent) : $line;

            # ~

            $Line = array('body' => $line, 'indent' => $indent, 'text' => $text);

            # ~

            if (isset($CurrentBlock['continuable'])) {

                if ($CurrentBlock['type'] === 'Quote') {

                    if (!isset($CurrentBlock['interrupted'])) {
                        $Block = $this->{'block' . $CurrentBlock['type'] . 'Continue'}($Line, $CurrentBlock);
                        if (isset($Block)) {
                            $CurrentBlock = $Block;

                            continue;
                        } else {
                            if ($this->isBlockCompletable($CurrentBlock['type'])) {
                                $CurrentBlock = $this->{'block' . $CurrentBlock['type'] . 'Complete'}($CurrentBlock);
                            }
                        }
                    }
                } else {
                    $Block = $this->{'block' . $CurrentBlock['type'] . 'Continue'}($Line, $CurrentBlock);
                    if (isset($Block)) {
                        $CurrentBlock = $Block;

                        continue;
                    } else {
                        if ($this->isBlockCompletable($CurrentBlock['type'])) {
                            $CurrentBlock = $this->{'block' . $CurrentBlock['type'] . 'Complete'}($CurrentBlock);
                        }
                    }
                }
            }


            # ~

            $marker = $text[0];

            # ~

            $blockTypes = $this->unmarkedBlockTypes;

            if (isset($this->BlockTypes[$marker])) {
                foreach ($this->BlockTypes[$marker] as $blockType) {
                    $blockTypes[] = $blockType;
                }
            }

            #
            # ~

            foreach ($blockTypes as $blockType) {
                $Block = $this->{'block' . $blockType}($Line, $CurrentBlock);

                if (isset($Block)) {
                    $Block['type'] = $blockType;

                    if (!isset($Block['identified'])) {
                        $Blocks[] = $CurrentBlock;

                        $Block['identified'] = true;
                    }

                    if ($this->isBlockContinuable($blockType)) {
                        $Block['continuable'] = true;
                    }

                    $CurrentBlock = $Block;

                    continue 2;
                }
            }

            # ~

            if (isset($CurrentBlock) and !isset($CurrentBlock['type']) and !isset($CurrentBlock['interrupted'])) {
                $CurrentBlock['element']['text'] .= "\n" . $text;
            } else {
                $Blocks[] = $CurrentBlock;

                $CurrentBlock = $this->paragraph($Line);

                $CurrentBlock['identified'] = true;
            }
        }

        # ~

        if (isset($CurrentBlock['continuable']) and $this->isBlockCompletable($CurrentBlock['type'])) {
            $CurrentBlock = $this->{'block' . $CurrentBlock['type'] . 'Complete'}($CurrentBlock);
        }

        # ~

        $Blocks[] = $CurrentBlock;

        unset($Blocks[0]);

        # ~

        $markup = '';

        foreach ($Blocks as $Block) {
            if (isset($Block['hidden'])) {
                continue;
            }

            $markup .= "\n";
            $markup .= isset($Block['markup']) ? $Block['markup'] : $this->element($Block['element']);
        }

        $markup .= "\n";

        # ~

        return $markup;
    }

    protected function inlineInternalLink($Excerpt)
    {
        if (!preg_match('/^\[\[(.+?)\]\]/', $Excerpt['text'], $matches)) {
            return;
        }

        $raw = $matches[1];

        // Split Obsidian-style: file|label|popup
        $parts = explode('|', $raw);
        $linkFile = $parts[0];

        $ext = pathinfo($linkFile, PATHINFO_EXTENSION);
        $openNewTab = false;

        if (in_array($ext, $this->allowedFileLinkTypes)) {
            $openNewTab = true;
        }

        $linkText = $parts[1] ?? $parts[0];
        $isPopup = isset($parts[2]);

        $popupClass = $isPopup ? ' internal-popup' : '';
        $popupIcon = $isPopup ? $this->popupIconSvg() : '';

        // Determine relative traversal
        $path = $this->path;


        if (str_starts_with($linkFile, '../')) {
            $depth = substr_count($linkFile, '../');
            $segments = explode('/', $this->path);
            $segments = array_slice($segments, 0, count($segments) - $depth);
            $path = implode('/', $segments);
            $linkFile = preg_replace('#^(\.\./)+#', '', $linkFile);

        }

        // use only the file name for nice links
        if ($this->niceLinks == true) {
            $segments = explode('/', $linkText);
            $segments = array_slice($segments, count($segments) - 1, 1);
            $linkText = $segments[0];
        }


        if ($openNewTab == false) {
            $segments = explode('/', $path);
            $segments = array_slice($segments, 1, count($segments));
            $path = implode('/', $segments);
        }


        $urlPath = ltrim($path . '/' . $linkFile, '/');

        // Same-document anchor
        if (str_starts_with($raw, '#')) {
            return array(
                'extent' => strlen($matches[0]),
                'element' => array(
                    'name' => 'a',
                    'text' => $linkText,
                    'attributes' => array(
                        'href' => '#' . ltrim($raw, '#'),
                        'class' => 'internal-link' . $popupClass,
                    ),
                ),
            );
        }

        // URL normalization (ported exactly)
        if ($openNewTab == false) {
            $urlPath = str_replace('&amp;', '&', $urlPath);
            $urlPath = str_replace('%23', '#', $urlPath);
            $urlPath = str_replace('~', '%80', $urlPath);
            $urlPath = str_replace('-', '~', $urlPath);
            $urlPath = str_replace(' ', '-', $urlPath);
        }

        return array(
            'extent' => strlen($matches[0]),
            'element' => array(
                'name' => 'a',
                'handler' => 'line',
                'text' => $linkText,
                'attributes' => array(
                    'href' => $this->uriPath . $urlPath,
                    'class' => 'internal-link' . $popupClass,
                    'target' => $openNewTab ? '_blank' : null,
                    'rel' => $openNewTab ? 'noopener noreferrer' : null,
                ),
                'suffix' => $popupIcon,
            ),
        );
    }

    protected function inlineInternalMarkdownLink($Excerpt)
    {
        // Match [label](path) — but NOT external URLs
        if (!preg_match('/^\[([^\]]+)\]\(([^)]+)\)/', $Excerpt['text'], $m)) {
            return;
        }

        $label = $m[1];
        $path = $m[2];

        // Reject external links explicitly
        if (preg_match('#^[a-z][a-z0-9+.-]*://#i', $path)) {
            return;
        }

        // Reject protocol-relative URLs
        if (str_starts_with($path, '//')) {
            return;
        }

        // Convert into Obsidian-style payload
        // [[path|label]]
        $synthetic = '[[' . $path . '|' . $label . ']]';

        // Delegate to inlineInternalLink()
        $result = $this->inlineInternalLink([
            'text' => $synthetic,
        ]);

        if ($result === null) {
            return;
        }

        // Adjust extent to original Markdown syntax length
        $result['extent'] = strlen($m[0]);

        return $result;
    }

    protected function inlineInternalEmbed($Excerpt)
    {
        if (!preg_match('/^!\[\[(.+?)\]\]/', $Excerpt['text'], $m)) {
            return;
        }

        $raw = $m[1];
        $parts = explode('|', $raw);

        $file = $parts[0];
        $mod1 = $parts[1] ?? null;
        $mod2 = $parts[2] ?? null;

        $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
        $src = rtrim($this->uriPath . $this->path, '/') . '/' . $file;

        if (str_contains($file, '#')) {
            $ext = strtolower(pathinfo(explode('#', $file)[0], PATHINFO_EXTENSION));
        }

        /* ---------- PDF ---------- */
        if ($ext === 'pdf') {
            return array(
                'extent' => strlen($m[0]),
                'element' => array(
                    'name' => 'embed',
                    'attributes' => array(
                        'src' => $src,
                        'type' => 'application/pdf',
                        'style' => 'min-height:100vh;width:100%',
                    ),
                ),
            );
        }

        /* ---------- Video / Audio ---------- */
        if (in_array($ext, array('mp4', 'm4a'))) {
            return array(
                'extent' => strlen($m[0]),
                'element' => array(
                    'name' => 'video',
                    'handler' => 'line',
                    'attributes' => array(
                        'controls' => true,
                        'src' => $src,
                        'type' => $ext === 'mp4' ? 'video/mp4' : 'audio/x-m4a',
                    ),
                    'text' =>
                        '<a class="internal-link" target="_blank" rel="noopener noreferrer" href="' .
                        $src . '">Download ' . basename($file) . '</a>',
                ),
            );
        }

        /* ---------- Image ---------- */
        if (in_array($ext, $this->allowedImageTypes)) {

            // Perlite syntax: image.png#caption=...&size=...
            if (str_contains($file, '#') && str_contains(explode('#', $file, 2)[1], '=')) {
                return $this->buildInternalImageFromFragment(
                    $file,
                    strlen($m[0])
                );
            }

            // Obsidian / ITS syntax: image.png#cap#wtiny|alt text|300
            // (the #fragment is kept on the embed's src, where ITS reads it)

            // syntax: image.png|Caption|300x200|center
            return $this->buildInternalImageFromLegacy(
                $raw,
                strlen($m[0])
            );
        }


    }

    # External / markdown images, handled like Obsidian:
    #   ![alt|300](url) or ![alt|300x200](url) -> width/height, alt "alt"
    #   ![alt|options]() (empty url, used in ITS templates) -> empty image
    protected function inlineImage($Excerpt)
    {
        if (preg_match('/^!\[([^\]]*)\]\(\s*\)/', $Excerpt['text'], $m)) {
            return array(
                'extent' => strlen($m[0]),
                'element' => array(
                    'name' => 'img',
                    'attributes' => array('src' => '', 'alt' => $m[1]),
                ),
            );
        }

        $Inline = parent::inlineImage($Excerpt);
        if ($Inline === null) {
            return;
        }

        $alt = $Inline['element']['attributes']['alt'] ?? '';
        if (preg_match('/^(.*)\|(\d+)(?:x(\d+))?$/s', $alt, $m)) {
            $Inline['element']['attributes']['alt'] = $m[1];
            $Inline['element']['attributes']['width'] = $m[2];
            if (!empty($m[3])) {
                $Inline['element']['attributes']['height'] = $m[3];
            }
        }

        return $Inline;
    }

    protected function buildInternalImage(string $file, array $attrs, int $extent)
    {
        # "image.png#cap#right" -> file "image.png", embed src keeps the fragment
        $linkText = $file;
        $file = explode('#', $file, 2)[0];
        $src = rtrim($this->uriPath . $this->path, '/') . '/' . $file;

        $class = 'images';
        $alt = $attrs['caption'] ?? 'image';
        $width = null;
        $height = null;

        if (!empty($attrs['align'])) {
            $class .= ' ' . $attrs['align'];
        }

        # Obsidian sizes: 300 (width only) or 300x200
        if (!empty($attrs['size']) && preg_match('/^(\d*)(?:x(\d*))?$/', $attrs['size'], $m)) {
            $width = $m[1] ?: null;
            $height = ($m[2] ?? "") ?: null;
        }

        # Same structure as Obsidian's reading view, so theme/snippet selectors
        # (.image-embed[alt~=right], .image-embed[src*="#cap"], .image-embed > img)
        # match:  <span class="internal-embed media-embed image-embed" src alt><img></span>
        # It must be inline: a <p> wrapper would be nested inside the paragraph
        # Parsedown already opened, which browsers split into separate blocks.
        # "pop" keeps Perlite's click-to-zoom working.
        return [
            'extent' => $extent,
            'element' => [
                'name' => 'span',
                'attributes' => array_filter([
                    'class' => 'internal-embed media-embed image-embed is-loaded pop',
                    'src' => $linkText,
                    'alt' => $attrs['caption'] ?? null,
                    'width' => $width,
                    'height' => $height,
                ]),
                'elements' => [
                    [
                        'name' => 'img',
                        'attributes' => array_filter([
                            'src' => $src,
                            'class' => $class,
                            'alt' => $alt,
                            'width' => $width,
                            'height' => $height,
                        ]),
                    ],
                ],
            ],
        ];
    }

    protected function buildInternalImageFromFragment(string $file, int $extent)
    {
        [$file, $fragment] = explode('#', $file, 2);

        parse_str($fragment, $attrs);

        return $this->buildInternalImage(
            $file,
            [
                'caption' => $attrs['caption'] ?? null,
                'size' => $attrs['size'] ?? null,
                'align' => $attrs['align'] ?? null,
            ],
            $extent
        );
    }

    protected function buildInternalImageFromLegacy(string $raw, int $extent)
    {
        $parts = explode('|', $raw);
        $file = array_shift($parts);

        $attrs = [
            'caption' => null,
            'size' => null,
            'align' => null,
        ];

        # Like Obsidian: a size part (300 / 300x200) sets the size, all other
        # text becomes the alt text. Themes/snippets such as ITS image
        # adjustments style images by alt (e.g. img[alt*=right]), so the
        # modifiers must survive into alt.
        $altParts = array();
        foreach ($parts as $part) {
            $part = trim($part);
            if (preg_match('/^(\d+(x\d*)?|x\d+)$/', $part)) {
                $attrs['size'] = $part;
            } elseif ($part !== '') {
                $altParts[] = $part;
                # keep Perlite's own alignment classes working without a theme
                if (in_array($part, ['center', 'right'], true)) {
                    $attrs['align'] = $part;
                }
            }
        }
        if ($altParts) {
            $attrs['caption'] = implode('|', $altParts);
        }

        return $this->buildInternalImage($file, $attrs, $extent);
    }

    #
    # Front matter cssclasses (Obsidian: "cssclasses" list, legacy "cssclass")
    #   cssclasses: [a, b] | cssclasses: a, b | cssclasses:\n  - a\n  - b

    protected function frontmatterCssClasses(string $yaml)
    {
        $classes = array();
        $lines = explode("\n", str_replace("\r", '', $yaml));
        for ($i = 0; $i < count($lines); $i++) {
            if (!preg_match('/^(cssclasses|cssclass)\s*:\s*(.*)$/i', $lines[$i], $m)) {
                continue;
            }
            $value = trim($m[2]);
            if ($value === '') {
                # block list
                while (isset($lines[$i + 1]) && preg_match('/^\s*-\s*(.+)$/', $lines[$i + 1], $item)) {
                    $classes[] = $item[1];
                    $i++;
                }
            } else {
                $value = trim($value, '[]');
                foreach (preg_split('/[,\s]+/', $value) as $v) {
                    $classes[] = $v;
                }
            }
        }
        $clean = array();
        foreach ($classes as $c) {
            $c = trim($c, " \t'\"");
            if ($c !== '' && preg_match('/^[A-Za-z0-9_-]+$/', $c)) {
                $clean[] = $c;
            }
        }
        return implode(' ', array_unique($clean));
    }

    #
    # Note embeds (transclusion), rendered like Obsidian's reading view:
    #   ![[Note]]  ![[Note#Heading]]  ![[Note#^block-id]]  ![[Note|clean no-title]]
    # Only notes Perlite already serves ($avFiles) can be embedded, so hidden
    # folders stay hidden. Only whole-line embeds (a line with just the embed).

    protected function blockNoteEmbed($Line)
    {
        if (!preg_match('/^!\[\[([^\]]+)\]\]\s*$/', $Line['text'], $m)) {
            return;
        }

        $parts = explode('|', $m[1]);
        $target = trim(array_shift($parts));
        $alt = trim(implode('|', $parts));

        $hashPos = strpos($target, '#');
        $file = $hashPos === false ? $target : substr($target, 0, $hashPos);
        $sub = $hashPos === false ? '' : substr($target, $hashPos + 1);

        # images, pdf, video ... are handled by the inline embed code
        $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
        $mediaTypes = array_merge($this->allowedImageTypes, $this->allowedFileLinkTypes,
            array('pdf', 'mp4', 'm4a', 'webm', 'mp3', 'wav', 'ogg', 'mov'));
        if ($ext !== '' && in_array($ext, $mediaTypes, true)) {
            return;
        }

        $html = $this->renderNoteEmbed($file, $sub, $target, $alt);
        if ($html === null) {
            return;
        }

        return array('markup' => $html);
    }

    protected function currentNotePath()
    {
        global $cleanFile;
        if ($this->currentNote !== null) {
            return $this->currentNote;
        }
        return is_string($cleanFile ?? null) ? $cleanFile : '';
    }

    protected static function normalizeVaultPath(string $path)
    {
        $out = array();
        foreach (explode('/', $path) as $seg) {
            if ($seg === '' || $seg === '.') {
                continue;
            }
            if ($seg === '..') {
                array_pop($out);
                continue;
            }
            $out[] = $seg;
        }
        return '/' . implode('/', $out);
    }

    # resolve like Obsidian: relative to the current note, from the vault
    # root, then by file name anywhere in the vault (shortest path wins)
    protected function resolveNote(string $file)
    {
        global $avFiles;
        if (!is_array($avFiles)) {
            return null;
        }

        $current = $this->currentNotePath();
        $file = preg_replace('/\.md$/i', '', trim($file));
        if ($file === '') {
            return in_array($current, $avFiles, true) ? $current : null;
        }

        $dir = ($current !== '' && strrpos($current, '/') !== false) ? substr($current, 0, strrpos($current, '/')) : '';
        foreach (array($dir . '/' . $file, '/' . $file) as $candidate) {
            $candidate = self::normalizeVaultPath($candidate);
            if (in_array($candidate, $avFiles, true)) {
                return $candidate;
            }
        }

        $suffix = strtolower('/' . ltrim(self::normalizeVaultPath($file), '/'));
        $best = null;
        foreach ($avFiles as $f) {
            if (substr(strtolower($f), -strlen($suffix)) === $suffix && ($best === null || strlen($f) < strlen($best))) {
                $best = $f;
            }
        }
        return $best;
    }

    protected function extractNoteSection(string $md, string $sub)
    {
        # drop front matter
        $md = preg_replace('/\A---\r?\n.*?\r?\n---\s*(\r?\n|\z)/s', '', str_replace("\r\n", "\n", $md));
        if ($sub === '') {
            return $md;
        }

        $subs = explode('#', $sub);
        $want = trim(end($subs));
        $lines = explode("\n", $md);

        # block reference: ![[Note#^id]]
        if (substr($want, 0, 1) === '^') {
            $id = preg_quote(substr($want, 1), '/');
            foreach ($lines as $i => $line) {
                if (!preg_match('/\s\^' . $id . '\s*$/', $line)) {
                    continue;
                }
                $start = $i;
                $end = $i;
                if (!preg_match('/^\s*([-*+]|\d+\.)\s/', $line)) {
                    while ($start > 0 && trim($lines[$start - 1]) !== '') {
                        $start--;
                    }
                }
                $block = array_slice($lines, $start, $end - $start + 1);
                $block[count($block) - 1] = preg_replace('/\s\^' . $id . '\s*$/', '', $block[count($block) - 1]);
                return implode("\n", $block);
            }
            return null;
        }

        # heading: from the heading to the next heading of the same or higher level
        $inFence = false;
        $level = null;
        $out = array();
        foreach ($lines as $line) {
            if (preg_match('/^\s*(```|~~~)/', $line)) {
                $inFence = !$inFence;
            }
            $isHeading = !$inFence && preg_match('/^(#{1,6})\s+(.*?)\s*#*\s*$/', $line, $h);
            if ($level === null) {
                if ($isHeading && strcasecmp(trim($h[2]), $want) === 0) {
                    $level = strlen($h[1]);
                    $out[] = $line;
                }
                continue;
            }
            if ($isHeading && strlen($h[1]) <= $level) {
                break;
            }
            $out[] = $line;
        }
        return $level === null ? null : implode("\n", $out);
    }

    protected function renderNoteEmbed(string $file, string $sub, string $target, string $alt)
    {
        global $rootDir, $startDir, $absolutePath;

        $note = $this->resolveNote($file);
        if ($note === null) {
            return null; # unknown note: fall back to Perlite's normal link
        }

        $key = $note . '#' . $sub;
        if (in_array($key, self::$embedStack, true) || count(self::$embedStack) >= 4) {
            return null;
        }

        $mdFile = $rootDir . $note . '.md';
        if (!is_file($mdFile)) {
            return null;
        }
        $md = $this->extractNoteSection((string) file_get_contents($mdFile), $sub);
        if ($md === null) {
            return null;
        }

        # render the embedded note with its own folder for relative links/images
        $noteDir = substr($note, 0, (int) strrpos($note, '/'));
        $path = !empty($absolutePath) ? $startDir : $startDir . $noteDir;
        $Parser = new static($path, $this->uriPath, $this->niceLinks, $this->allowedFileLinkTypes, $this->allowedImageTypes);
        $Parser->setSafeMode($this->safeMode);
        $Parser->setBreaksEnabled($this->breaksEnabled);
        $Parser->currentNote = $note;

        self::$embedStack[] = $key;
        try {
            $inner = $Parser->text($md);
        } finally {
            array_pop(self::$embedStack);
        }

        # link to the note, same URL format as Perlite's internal links
        $urlPath = ltrim($note, '/');
        $urlPath = str_replace('~', '%80', $urlPath);
        $urlPath = str_replace('-', '~', $urlPath);
        $urlPath = str_replace(' ', '-', $urlPath);
        $href = $this->uriPath . $urlPath . ($sub !== '' ? '#' . str_replace(' ', '_', ltrim(basename(str_replace('#', '/', $sub)), '^')) : '');

        $title = basename($note);

        return '<div class="internal-embed markdown-embed inline-embed is-loaded" src="' . self::escape($target) . '"'
            . ($alt !== '' ? ' alt="' . self::escape($alt) . '"' : '') . '>'
            . '<div class="embed-title markdown-embed-title">' . self::escape($title) . '</div>'
            . '<div class="markdown-embed-content"><div class="markdown-preview-view markdown-rendered">'
            . '<div class="markdown-preview-sizer markdown-preview-section">' . "\n" . $inner . "\n" . '</div></div></div>'
            . '<a class="markdown-embed-link internal-link" href="' . self::escape($href) . '" aria-label="Open link">'
            . '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-link"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>'
            . '</a></div>';
    }

    #
    # Footnotes (Obsidian / markdown-it style)
    #   reference:  text[^1]  or  text[^my-note]
    #   definition: [^1]: footnote text   (indented following lines continue it)

    protected function extractFootnoteDefinitions(array $lines)
    {
        $this->footnoteDefinitions = array();
        $this->footnoteNumbers = array();
        $this->footnoteRefCounts = array();

        $out = array();
        $inFence = false;
        $current = null;

        foreach ($lines as $line) {
            # don't touch anything inside fenced code blocks
            if (preg_match('/^\s*(```|~~~)/', $line)) {
                $inFence = !$inFence;
                $current = null;
                $out[] = $line;
                continue;
            }

            if (!$inFence && preg_match('/^\[\^([^\]\s]+)\]:[ \t]?(.*)$/', $line, $m)) {
                $current = $m[1];
                $this->footnoteDefinitions[$current] = $m[2];
                continue;
            }

            # indented continuation lines belong to the previous definition
            if ($current !== null && preg_match('/^(?: {4}|\t)(.*)$/', $line, $m)) {
                $this->footnoteDefinitions[$current] .= "\n" . $m[1];
                continue;
            }

            $current = null;
            # hide Obsidian block ids ("text ^my-block"), like Obsidian's reading view
            if (!$inFence) {
                $line = preg_replace('/(\S)[ \t]+\^[A-Za-z0-9-]+[ \t]*$/', '$1', $line);
            }
            $out[] = $line;
        }

        return $out;
    }

    protected function inlineFootnoteMarker($Excerpt)
    {
        if (!preg_match('/^\[\^([^\]\s]+)\]/', $Excerpt['text'], $m)) {
            return;
        }

        $id = $m[1];

        # like Obsidian, leave [^x] as plain text if it has no definition
        if (!isset($this->footnoteDefinitions[$id])) {
            return;
        }

        if (!isset($this->footnoteNumbers[$id])) {
            $this->footnoteNumbers[$id] = count($this->footnoteNumbers) + 1;
            $this->footnoteRefCounts[$id] = 0;
        }
        $this->footnoteRefCounts[$id]++;

        $num = $this->footnoteNumbers[$id];
        $refId = 'fnref-' . $num . ($this->footnoteRefCounts[$id] > 1 ? '-' . $this->footnoteRefCounts[$id] : '');

        return array(
            'extent' => strlen($m[0]),
            'markup' => '<sup class="footnote-ref" id="' . $refId . '" data-footnote-id="' . $refId . '">'
                . '<a href="#fn-' . $num . '" class="footnote-link">[' . $num . ']</a></sup>',
        );
    }

    protected function buildFootnotesSection()
    {
        if (empty($this->footnoteDefinitions)) {
            return '';
        }

        # referenced footnotes in reference order, then any unreferenced ones
        $ordered = $this->footnoteNumbers;
        asort($ordered);
        foreach (array_keys($this->footnoteDefinitions) as $id) {
            if (!isset($ordered[$id])) {
                $ordered[$id] = null;
            }
        }

        $items = '';
        foreach ($ordered as $id => $num) {
            $text = $this->line(trim($this->footnoteDefinitions[$id]));
            if ($num === null) {
                $items .= "<li class=\"footnote-item\"><p>" . $text . "</p></li>\n";
                continue;
            }
            $backrefs = '';
            for ($i = 1; $i <= $this->footnoteRefCounts[$id]; $i++) {
                $refId = 'fnref-' . $num . ($i > 1 ? '-' . $i : '');
                $backrefs .= ' <a href="#' . $refId . '" class="footnote-backref footnote-link">↩︎</a>';
            }
            $items .= '<li id="fn-' . $num . '" class="footnote-item" data-footnote-id="fn-' . $num . '"><p>'
                . $text . $backrefs . "</p></li>\n";
        }

        return "\n<section class=\"footnotes\">\n<hr class=\"footnotes-sep\">\n<ol class=\"footnotes-list\">\n"
            . $items . "</ol>\n</section>";
    }

    protected function popupIconSvg()
    {
        return '<svg class="popup-icon" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 3H5a2 2 0 0 0-2 2v3"></path>
        <path d="M21 8V5a2 2 0 0 0-2-2h-3"></path>
        <path d="M3 16v3a2 2 0 0 0 2 2h3"></path>
        <path d="M16 21h3a2 2 0 0 0 2-2v-3"></path>
    </svg>';
    }

}